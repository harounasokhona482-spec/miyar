import type { Transaction } from "../domain/schemas/transaction";
import { comparable } from "./evidenceValidators";
import { listExtractedFields, type Field } from "./extraction";

/**
 * Read-only views of a transaction for evidence predicates.
 *
 * - "established" accessors read explicit facts only (any evidence_origin:
 *   initial message, clarification choice or clarification free text);
 *   they decide whether a condition holds or fails.
 * - "selection" accessors may also read inferred values and the category;
 *   they only decide which issues/records to look at, never sufficiency.
 */

export type Tri = "holds" | "fails" | "unknown";

const explicit = (f: Field): boolean => f.provenance === "explicit" && f.value !== null;

function textOf(f: Field): string {
  return comparable(`${typeof f.value === "string" ? f.value : ""} ${f.evidence_span ?? ""}`);
}

function hasStem(text: string, stems: readonly string[]): boolean {
  return text.split(" ").some((w) => stems.some((s) => w.includes(s)));
}

// Normalized stems.
// «تقسيط» is ت-ق-س-ي-ط, so it needs its own stem; «أقساط» → «قساط».
const INSTALLMENT = ["قسط", "قسيط", "قساط", "دفعات"];
const SALE = ["بيع", "يبيع", "تبيع", "باع"];
const PURCHASE_OR_OWN = ["شتر", "شراء", "شرائ", "ملك", "متلك", "مالك"];
const NEGATION = /(?<!\p{L})(?:لا|ولا|لم|ليس|ليست|غير)(?!\p{L})|(?<!\p{L})فقط(?!\p{L})/u;
const ACCELERATION = ["مستحق", "حلول", "تحل", "تعجيل", "فورا"];
const CONTRACT_TERM = ["عقد", "شرط", "اتفاق", "ينص"];
const RATE_OR_TIME = ["نسبه", "فائده", "فوائد", "سنوي", "شهري", "بالمئه"];

export class TransactionFacts {
  constructor(readonly t: Transaction) {}

  private explicitFields() {
    return listExtractedFields(this.t).filter(({ field }) => explicit(field));
  }

  // --- established (explicit only) -----------------------------------------

  /** The relationship as stated by the user, or null. */
  relationship(): "sale" | "loan" | "murabaha" | null {
    const r = this.t.relationship_type;
    return explicit(r) && r.value !== "unknown" ? (r.value as "sale" | "loan" | "murabaha") : null;
  }

  isSale(): Tri {
    const r = this.relationship();
    return r === "sale" ? "holds" : r === "loan" ? "fails" : "unknown";
  }

  isLoan(): Tri {
    const r = this.relationship();
    return r === "loan" ? "holds" : r === "sale" || r === "murabaha" ? "fails" : "unknown";
  }

  /** Payment in installments / several payments, stated by the user. */
  installments(): Tri {
    const fields = [this.t.payment_method, this.t.payment_schedule];
    return fields.some((f) => explicit(f) && hasStem(textOf(f), INSTALLMENT)) ? "holds" : "unknown";
  }

  priceFixedAtContract(): Tri {
    const f = this.t.price_fixed_at_contract;
    return explicit(f) ? (f.value === true ? "holds" : "fails") : "unknown";
  }

  increaseConditionedAtContract(): Tri {
    const f = this.t.increase_conditioned_at_contract;
    return explicit(f) ? (f.value === true ? "holds" : "fails") : "unknown";
  }

  returnOrProfitStated(): boolean {
    return explicit(this.t.return_or_profit);
  }

  /** The stated return/increase is computed by amount or time (rate, interest, per year...). */
  increaseByAmountOrTime(): Tri {
    const f = this.t.return_or_profit;
    return explicit(f) && hasStem(textOf(f), RATE_OR_TIME) ? "holds" : "unknown";
  }

  productStated(): boolean {
    return explicit(this.t.product_or_service);
  }

  financingPartyStated(): boolean {
    return explicit(this.t.financing_party);
  }

  /** Whether the intermediary buys/owns the goods before selling: holds, fails (explicit negative), unknown. */
  intermediaryOwnsBeforeSale(): Tri {
    const f = this.t.ownership_transfer;
    if (!explicit(f)) return "unknown";
    const text = textOf(f);
    if (NEGATION.test(comparable(String(f.value)))) return "fails";
    return hasStem(text, PURCHASE_OR_OWN) ? "holds" : "unknown";
  }

  /** Some explicit statement says the goods are sold on to the customer. */
  soldOnToCustomer(): Tri {
    return this.explicitFields().some(({ field }) => hasStem(textOf(field), SALE)) ? "holds" : "unknown";
  }

  /** A monetary amount is charged because of late payment: holds / fails (explicitly none) / unknown. */
  lateMonetaryAmount(): Tri {
    const f = this.t.late_penalty.exists;
    return explicit(f) ? (f.value === true ? "holds" : "fails") : "unknown";
  }

  lateAmountDescribed(): boolean {
    return explicit(this.t.late_penalty.details);
  }

  /**
   * Remaining installments become due on late payment (acceleration), stated by the user.
   * Needs both a "becomes due" word and an installment word: «المبلغ المستحق» alone is not acceleration.
   */
  accelerationClause(): Tri {
    const f = this.t.late_penalty.details;
    if (!explicit(f)) return "unknown";
    const text = textOf(f);
    return hasStem(text, ACCELERATION) && hasStem(text, INSTALLMENT) ? "holds" : "unknown";
  }

  /** The acceleration term is part of the contract (agreed when contracting). */
  accelerationInContract(): Tri {
    const f = this.t.late_penalty.details;
    return explicit(f) && hasStem(comparable(f.evidence_span ?? ""), CONTRACT_TERM) ? "holds" : "unknown";
  }

  feesStated(): boolean {
    const f = this.t.fees.exists;
    return explicit(f) && f.value === true;
  }

  /** Any explicit span or value contains one of the normalized stems (fixture predicates use this). */
  mentions(stems: readonly string[]): boolean {
    return this.explicitFields().some(({ field }) => hasStem(textOf(field), stems));
  }

  // --- selection only (may use inferred values and category) ---------------

  /** For choosing issues: explicit relationship, else inferred, else the category's usual relationship. */
  selectionRelationship(): "sale" | "loan" | "murabaha" | null {
    const r = this.t.relationship_type;
    if (r.value && r.value !== "unknown" && r.provenance !== "unknown") return r.value as "sale" | "loan" | "murabaha";
    const byCategory: Record<string, "sale" | "loan" | "murabaha"> = {
      sale_installments: "sale",
      murabaha_purchase_orderer: "murabaha",
      loan_with_conditioned_increase: "loan",
      interest_bearing_loan: "loan",
    };
    return byCategory[this.t.category] ?? null;
  }
}
