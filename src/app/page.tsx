import { PRODUCT_DISCLAIMER } from "../domain/messages";

// Placeholder only. The real screens (question, confirmation, clarification,
// verification, result) come in a later step.
export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">مِعيار</h1>
      <p className="mt-4 text-base opacity-80">{PRODUCT_DISCLAIMER}</p>
    </main>
  );
}
