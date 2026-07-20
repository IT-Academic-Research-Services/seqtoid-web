require "rails_helper"

# Branch sweep for Auth0UserManagementHelper. The existing spec covers
# unverified_auth0_users and normalize_auth0_domain; this file targets the
# uncovered role/identity branches: the admin-vs-regular arms of
# create_auth0_user + change_auth0_user_role, the empty-vs-existing arms of
# patch_auth0_user, and the identity flattening in get/delete by email.
# The Auth0 management client is stubbed so no network call is made. Each
# example flips a single branch. Spec-only.
RSpec.describe Auth0UserManagementHelper do
  let(:client) { double("auth0_management_client") }

  before do
    allow(Auth0UserManagementHelper).to receive(:auth0_management_client).and_return(client)
  end

  describe ".create_auth0_user role arm" do
    before { allow(UsersHelper).to receive(:generate_random_password).and_return("pw") }

    it "creates a regular user with empty role metadata and assigns NO Auth0 role" do
      expect(client).to receive(:create_user).with(
        Auth0UserManagementHelper::AUTH0_CONNECTION_NAME,
        hash_including(email: "r@x.co", name: "Reg", app_metadata: { roles: [] })
      ).and_return("user_id" => "u1")
      expect(client).not_to receive(:get_roles)
      expect(client).not_to receive(:add_user_roles)

      expect(Auth0UserManagementHelper.create_auth0_user(email: "r@x.co", name: "Reg"))
        .to eq("user_id" => "u1")
    end

    it "creates an admin user with admin role metadata and assigns the Auth0 Admin role" do
      expect(client).to receive(:create_user).with(
        Auth0UserManagementHelper::AUTH0_CONNECTION_NAME,
        hash_including(app_metadata: { roles: ["admin"] })
      ).and_return("user_id" => "u2")
      allow(client).to receive(:get_roles).and_return([{ "name" => "Admin", "id" => "role-admin" }])
      expect(client).to receive(:add_user_roles).with("u2", ["role-admin"])

      Auth0UserManagementHelper.create_auth0_user(email: "a@x.co", name: "Adm", role: User::ROLE_ADMIN)
    end
  end

  describe ".patch_auth0_user existing-vs-missing arm" do
    it "creates a new Auth0 user when no ids resolve from the old email" do
      allow(Auth0UserManagementHelper).to receive(:get_auth0_user_ids_by_email)
        .with("old@x.co").and_return([])
      expect(Auth0UserManagementHelper).to receive(:create_auth0_user)
        .with(email: "new@x.co", name: "N", role: User::ROLE_REGULAR_USER)

      Auth0UserManagementHelper.patch_auth0_user(
        old_email: "old@x.co", email: "new@x.co", name: "N", role: User::ROLE_REGULAR_USER
      )
    end

    it "patches each existing user and ADDS the admin role when promoting to admin" do
      allow(Auth0UserManagementHelper).to receive(:get_auth0_user_ids_by_email)
        .with("old@x.co").and_return(["auth0|1"])
      allow(client).to receive(:get_roles).and_return([{ "name" => "Admin", "id" => "role-admin" }])
      expect(client).to receive(:patch_user).with(
        "auth0|1", hash_including(email: "new@x.co", name: "N", app_metadata: { roles: ["admin"] })
      )
      expect(client).to receive(:add_user_roles).with("auth0|1", ["role-admin"])

      Auth0UserManagementHelper.patch_auth0_user(
        old_email: "old@x.co", email: "new@x.co", name: "N", role: User::ROLE_ADMIN
      )
    end

    it "REMOVES the admin role when demoting an existing user to a regular role" do
      allow(Auth0UserManagementHelper).to receive(:get_auth0_user_ids_by_email)
        .and_return(["auth0|1"])
      allow(client).to receive(:get_roles).and_return([{ "name" => "Admin", "id" => "role-admin" }])
      allow(client).to receive(:patch_user)
      expect(client).to receive(:remove_user_roles).with("auth0|1", ["role-admin"])

      Auth0UserManagementHelper.patch_auth0_user(
        old_email: "o@x.co", email: "e@x.co", name: "N", role: User::ROLE_REGULAR_USER
      )
    end
  end

  describe ".get_auth0_user_ids_by_email" do
    it "flattens provider|user_id across every identity of every matching user" do
      allow(client).to receive(:users_by_email).with("e@x.co", fields: "identities").and_return(
        [
          { "identities" => [
            { "provider" => "auth0", "user_id" => "1" },
            { "provider" => "google", "user_id" => "2" },
          ] },
          { "identities" => [{ "provider" => "auth0", "user_id" => "3" }] },
        ]
      )

      expect(Auth0UserManagementHelper.get_auth0_user_ids_by_email("e@x.co"))
        .to eq(["auth0|1", "google|2", "auth0|3"])
    end
  end

  describe ".delete_auth0_user" do
    it "deletes every Auth0 user id resolved from the email" do
      allow(Auth0UserManagementHelper).to receive(:get_auth0_user_ids_by_email)
        .with("e@x.co").and_return(["auth0|1", "google|2"])
      expect(client).to receive(:delete_user).with("auth0|1")
      expect(client).to receive(:delete_user).with("google|2")

      Auth0UserManagementHelper.delete_auth0_user(email: "e@x.co")
    end
  end
end
