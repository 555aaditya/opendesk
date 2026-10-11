// Billing on (fake-stripe.mjs and STRIPE_* env, see that file): a new workspace
// is on Free with its limits and prices, the second mailbox asks for Pro, and
// Upgrade opens Checkout (the fake sends the browser straight back).

import { cfg } from "../lib.mjs";

export async function run(t) {
  const owner = t.owner.page;

  await t.step("billing on: Free plan with limits and prices", async () => {
    await owner.goto(cfg.app + "/settings/billing");
    await owner.getByText("Current plan").first().waitFor();
    await owner.getByText("Free", { exact: true }).first().waitFor();
    await owner.getByText("Plan limits").waitFor();
    await owner.getByText(/1 of 1/).first().waitFor();
    await owner.getByText(/\$19/).first().waitFor();
  });

  await t.step("billing on: Upgrade opens Checkout and comes back", async () => {
    await owner.getByRole("button", { name: "Upgrade to Pro" }).first().click();
    await owner.getByText(/Confirming your payment with Stripe/).first().waitFor();
  });
}
