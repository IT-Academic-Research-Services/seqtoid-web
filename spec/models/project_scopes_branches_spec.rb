require 'rails_helper'

# Coverage Wave (branch): project_spec.rb covers search/sort but never drives the
# admin-vs-member arms of the authorization scopes. This spec drives ONLY those
# branches with in-memory relations compared via #to_sql (no query executes, no
# DB writes) so each arm is hit and each test fails if its branch is inverted or
# removed:
#   - .editable: admin (all) vs member (projects_users subquery)
#   - .viewable: admin (all) vs member (projects_users + public-projects subquery)
RSpec.describe Project, type: :model do
  describe ".editable" do
    it "returns the unrestricted scope for an admin (if arm)" do
      sql = Project.editable(double("admin", admin?: true)).to_sql
      expect(sql).not_to include("projects_users")
    end

    it "restricts to the member's own projects for a non-admin (else arm)" do
      sql = Project.editable(double("member", admin?: false, id: 7)).to_sql
      expect(sql).to include("projects_users")
      expect(sql).to include("7")
    end
  end

  describe ".viewable" do
    it "returns the unrestricted scope for an admin (if arm)" do
      sql = Project.viewable(double("admin", admin?: true)).to_sql
      expect(sql).not_to include("projects_users")
    end

    it "restricts to the member's own + public projects for a non-admin (else arm)" do
      allow(Sample).to receive(:public_samples).and_return(double("rel", distinct: double("d", pluck: [3])))
      sql = Project.viewable(double("member", admin?: false, id: 7)).to_sql
      expect(sql).to include("projects_users")
      expect(sql).to include("7")
    end
  end
end
