import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";

/** Sign up once and reuse the session: signup is rate-limited to 5/hour. */
export default async function globalSetup(config: FullConfig) {
  const project = config.projects[0]!;
  const baseURL = project.use.baseURL!;
  const statePath = project.use.storageState as string;
  fs.mkdirSync("e2e/.auth", { recursive: true });

  const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
  const page = await browser.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByPlaceholder("you@example.com").fill(`e2e-${Date.now()}@example.com`);
  await page.getByPlaceholder("Minimum 8 characters").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Your documents" }).waitFor();
  await page.context().storageState({ path: statePath });
  await browser.close();
}
