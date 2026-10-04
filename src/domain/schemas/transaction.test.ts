import { describe, expect, it } from "vitest";
import { z } from "zod";
import { blankTransaction } from "./testHelpers";
import { TransactionSchema, extractedField, isEstablishedFact } from "./transaction";

const field = extractedField(z.string().min(1));

describe("extracted field provenance", () => {
  it("accepts an explicit fact with the user's words", () => {
    expect(field.safeParse({ value: "3400", provenance: "explicit", evidence_span: "يكون السعر 3400" }).success).toBe(true);
  });

  it("rejects an explicit fact without evidence_span", () => {
    expect(field.safeParse({ value: "3400", provenance: "explicit" }).success).toBe(false);
  });

  it("rejects an unknown field that carries a value", () => {
    expect(field.safeParse({ value: "البنك يمتلك السيارة", provenance: "unknown" }).success).toBe(false);
  });

  it("rejects an inferred field with no value", () => {
    expect(field.safeParse({ value: null, provenance: "inferred" }).success).toBe(false);
  });

  it("rejects evidence_span on inferred values so they cannot pose as quotes", () => {
    expect(field.safeParse({ value: "بيع", provenance: "inferred", evidence_span: "اشتريت" }).success).toBe(false);
  });

  it("never treats an inferred value as an established fact", () => {
    expect(isEstablishedFact({ value: "مرابحة", provenance: "inferred" })).toBe(false);
    expect(isEstablishedFact({ value: null, provenance: "unknown" })).toBe(false);
    expect(isEstablishedFact({ value: "مرابحة", provenance: "explicit" })).toBe(true);
  });
});

describe("TransactionSchema", () => {
  it("accepts a blank transaction", () => {
    expect(TransactionSchema.safeParse(blankTransaction()).success).toBe(true);
  });

  it("accepts the T009 shape: financing stated, ownership unknown", () => {
    const t = blankTransaction({
      category: "murabaha_purchase_orderer",
      financing_party: { value: "البنك", provenance: "explicit", evidence_span: "البنك سيمول السيارة" },
      ownership_transfer: { value: null, provenance: "unknown" },
      missing_information: ["هل يشتري البنك السيارة ويمتلكها قبل بيعها"],
      needs_clarification: true,
    });
    expect(TransactionSchema.safeParse(t).success).toBe(true);
  });

  it("rejects categories outside the approved list", () => {
    expect(TransactionSchema.safeParse(blankTransaction({ category: "crypto_staking" as never })).success).toBe(false);
  });
});
