import { Page } from "@playwright/test";

// Auth0 login form. The current Universal Login page names the email field "username" and the
// submit button "action"; the classic page used "email" and "submit". Match either so the suite
// keeps working whichever login experience a tenant serves.
const EMAIL_FIELD = 'input[name="username"], input[name="email"]';
const PASSWORD_FIELD = 'input[name="password"]';
const SUBMIT_BUTTON = 'button[type="submit"][name="action"], [name="submit"]';

export async function login(
  page: Page,
  username?: string,
  password?: string,
): Promise<void> {
  await page.locator(EMAIL_FIELD).first().fill(username as string);
  await page.locator(PASSWORD_FIELD).first().fill(password as string);
  await page.locator(SUBMIT_BUTTON).first().click();
  await page.waitForURL("**/my_data**");
}
