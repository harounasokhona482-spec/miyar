import type { Transaction } from "./transaction";

const unknown = { value: null, provenance: "unknown" } as const;

/** A schema-valid transaction where nothing is known; tests override fields. */
export function blankTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    category: "unknown",
    possible_classification: unknown,
    relationship_type: unknown,
    user_intent: "general_knowledge",
    in_scope: true,
    parties: [],
    product_or_service: unknown,
    payment_method: unknown,
    payment_schedule: unknown,
    fees: { exists: unknown, type: unknown, amount_or_rate: unknown },
    late_penalty: { exists: unknown, details: unknown },
    financing_party: unknown,
    ownership_transfer: unknown,
    return_or_profit: unknown,
    missing_information: [],
    needs_clarification: false,
    ...overrides,
  };
}
