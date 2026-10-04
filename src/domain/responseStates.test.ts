import { describe, expect, it } from "vitest";
import { RESPONSE_STATES, ResponseStateSchema, strongestState } from "./responseStates";

describe("response states", () => {
  it("defines exactly the six approved states", () => {
    expect([...RESPONSE_STATES].sort()).toEqual(
      ["DISPUTED", "GROUNDED", "INSUFFICIENT_EVIDENCE", "NEEDS_CLARIFICATION", "REFERRAL", "TECHNICAL_ERROR"].sort(),
    );
  });

  it("rejects POLICY_PRESERVED and composite states", () => {
    expect(ResponseStateSchema.safeParse("POLICY_PRESERVED").success).toBe(false);
    expect(ResponseStateSchema.safeParse("NEEDS_CLARIFICATION_OR_INSUFFICIENT_EVIDENCE").success).toBe(false);
  });
});

describe("strongestState", () => {
  it("lets REFERRAL override a grounded answer", () => {
    expect(strongestState(["GROUNDED", "REFERRAL"])).toBe("REFERRAL");
  });

  it("lets TECHNICAL_ERROR override everything", () => {
    expect(strongestState(["REFERRAL", "GROUNDED", "TECHNICAL_ERROR"])).toBe("TECHNICAL_ERROR");
  });

  it("prefers clarification over abstention, and abstention over DISPUTED/GROUNDED", () => {
    expect(strongestState(["INSUFFICIENT_EVIDENCE", "NEEDS_CLARIFICATION"])).toBe("NEEDS_CLARIFICATION");
    expect(strongestState(["GROUNDED", "INSUFFICIENT_EVIDENCE"])).toBe("INSUFFICIENT_EVIDENCE");
    expect(strongestState(["GROUNDED", "DISPUTED"])).toBe("DISPUTED");
  });

  it("returns GROUNDED only when nothing else applies", () => {
    expect(strongestState(["GROUNDED", "GROUNDED"])).toBe("GROUNDED");
  });

  it("treats an empty decision list as a technical error", () => {
    expect(strongestState([])).toBe("TECHNICAL_ERROR");
  });
});
