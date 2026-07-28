// Coverage: app/assets/src/api/user.ts
// updateUserData builds its payload with a chain of `!isNull(x)` guards, so the
// interesting branches are "explicit null omits the key" vs "any non-null value
// (including undefined) includes it". updateUser and postToAirtable are shape
// transforms (camelCase -> snake_case) worth pinning exactly.
import { postWithCSRF, putWithCSRF } from "~/api/core";
import {
  EMAIL_TAKEN_ERROR,
  postToAirtable,
  requestPasswordReset,
  updateUser,
  updateUserData,
} from "~/api/user";

jest.mock("~/api/core", () => ({
  postWithCSRF: jest.fn(),
  putWithCSRF: jest.fn(),
}));

const mockedPost = postWithCSRF as jest.Mock;
const mockedPut = putWithCSRF as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPost.mockResolvedValue({ ok: true });
  mockedPut.mockResolvedValue({ ok: true });
});

describe("EMAIL_TAKEN_ERROR", () => {
  it("matches the create_user.rb error string the UI compares against", () => {
    expect(EMAIL_TAKEN_ERROR).toBe("Email has already been taken");
  });
});

describe("updateUser", () => {
  it("PUTs the user payload with role 1 when isAdmin is true", async () => {
    await expect(
      updateUser({
        userId: 3,
        name: "Ada",
        email: "ada@example.com",
        institution: "UCSF",
        isAdmin: true,
        archetypes: '["Researcher"]',
        segments: '["Academic"]',
      }),
    ).resolves.toEqual({ ok: true });

    expect(mockedPut).toHaveBeenCalledWith("/users/3.json", {
      user: {
        name: "Ada",
        email: "ada@example.com",
        institution: "UCSF",
        archetypes: '["Researcher"]',
        segments: '["Academic"]',
        role: 1,
      },
    });
  });

  it("sends role 0 when isAdmin is false and leaves optional fields undefined", async () => {
    await updateUser({ userId: 4, name: "Bob", isAdmin: false });

    expect(mockedPut).toHaveBeenCalledWith("/users/4.json", {
      user: {
        name: "Bob",
        email: undefined,
        institution: undefined,
        archetypes: undefined,
        segments: undefined,
        role: 0,
      },
    });
  });

  it("treats an omitted isAdmin as non-admin", async () => {
    await updateUser({ userId: 5, name: "Cy" });
    expect(mockedPut.mock.calls[0][1].user.role).toBe(0);
  });

  it("propagates a rejection from the underlying request", async () => {
    mockedPut.mockRejectedValueOnce(new Error("409"));
    await expect(updateUser({ userId: 6, name: "Dee" })).rejects.toThrow("409");
  });
});

describe("updateUserData", () => {
  it("includes every field when all values are non-null", async () => {
    await updateUserData({
      userId: 10,
      name: "Ada",
      email: "ada@example.com",
      institution: "UCSF",
      isAdmin: true,
      archetypes: '["Researcher"]',
      segments: '["Academic"]',
      userProfileFormVersion: 2,
    });

    expect(mockedPost).toHaveBeenCalledWith("/users/10/update_user_data.json", {
      user: {
        name: "Ada",
        email: "ada@example.com",
        role: 1,
        institution: "UCSF",
        archetypes: '["Researcher"]',
        segments: '["Academic"]',
        profile_form_version: 2,
      },
    });
  });

  it("omits every optional key that is explicitly null", async () => {
    await updateUserData({
      userId: 11,
      name: "Bob",
      // @ts-expect-error the guards are `!isNull(...)`, so null is the "omit" signal
      email: null,
      // @ts-expect-error see above
      institution: null,
      // @ts-expect-error see above
      isAdmin: null,
      // @ts-expect-error see above
      archetypes: null,
      // @ts-expect-error see above
      segments: null,
      // @ts-expect-error see above
      userProfileFormVersion: null,
    });

    const payload = mockedPost.mock.calls[0][1].user;
    // `name` and `email` are seeded unconditionally; email stays null-seeded.
    expect(payload).toEqual({ name: "Bob", email: null });
    expect("role" in payload).toBe(false);
    expect("institution" in payload).toBe(false);
    expect("archetypes" in payload).toBe(false);
    expect("segments" in payload).toBe(false);
    expect("profile_form_version" in payload).toBe(false);
  });

  it("maps isAdmin false to role 0 rather than omitting it", async () => {
    await updateUserData({ userId: 12, name: "Cy", isAdmin: false });
    expect(mockedPost.mock.calls[0][1].user.role).toBe(0);
  });

  it("treats undefined (not null) values as present", async () => {
    await updateUserData({ userId: 13, name: "Dee" });
    const payload = mockedPost.mock.calls[0][1].user;
    // undefined is not null, so the guards all pass and the keys exist.
    expect("institution" in payload).toBe(true);
    expect("segments" in payload).toBe(true);
    expect(payload.institution).toBeUndefined();
    expect(payload.role).toBe(0);
  });

  it("returns the resolved response from the API", async () => {
    mockedPost.mockResolvedValueOnce({ user: { id: 14 } });
    await expect(updateUserData({ userId: 14, name: "Eve" })).resolves.toEqual({
      user: { id: 14 },
    });
  });
});

describe("postToAirtable", () => {
  const args = {
    userId: 20,
    firstName: "Ada",
    lastName: "Lovelace",
    profileFormVersion: 3,
    rorInstitution: "UCSF",
    rorId: "ror-1",
    country: "USA",
    worldBankIncome: "High income",
    expertiseLevel: "Expert",
    czidUsecases: ["research", "clinical"],
    referralSource: ["colleague"],
    newsletterConsent: true,
  };

  it("converts the camelCase args into the snake_case Airtable payload", async () => {
    await postToAirtable(args);

    expect(mockedPost).toHaveBeenCalledWith(
      "/users/20/post_user_data_to_airtable",
      {
        user: {
          first_name: "Ada",
          last_name: "Lovelace",
          profile_form_version: 3,
          ror_institution: "UCSF",
          ror_id: "ror-1",
          country: "USA",
          world_bank_income: "High income",
          expertise_level: "Expert",
          czid_usecase: ["research", "clinical"],
          referral_source: ["colleague"],
          newsletter_consent: true,
        },
      },
    );
  });

  it("passes newsletter_consent false through unchanged", async () => {
    await postToAirtable({ ...args, newsletterConsent: false });
    expect(mockedPost.mock.calls[0][1].user.newsletter_consent).toBe(false);
  });
});

describe("requestPasswordReset", () => {
  it("posts the email inside a user object to the auth0 route", async () => {
    await requestPasswordReset("ada@example.com");
    expect(mockedPost).toHaveBeenCalledWith("/auth0/request_password_reset", {
      user: { email: "ada@example.com" },
    });
  });

  it("propagates a rejection so the caller can surface the failure", async () => {
    mockedPost.mockRejectedValueOnce(new Error("rate limited"));
    await expect(requestPasswordReset("ada@example.com")).rejects.toThrow(
      "rate limited",
    );
  });
});
