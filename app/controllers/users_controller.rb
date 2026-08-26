class UsersController < ApplicationController
  skip_before_action :authenticate_user!, only: [:password_new, :register]
  before_action :admin_required, except: [:password_new, :register, :update_user_data, :post_user_data_to_airtable]
  before_action :set_user, only: [:edit, :update, :destroy, :update_user_data, :post_user_data_to_airtable, :initiate_s3_transfer, :transfer_jobs]

  # GET /users
  # GET /users.json
  def index
    @search_by = params["search_by"]
    @users = if @search_by
               User.where("name like ? OR email like ?", "%#{@search_by}%", "%#{@search_by}%").includes(:projects)
             else
               User.includes(:projects).all
             end
  end

  # POST /users
  # POST /users.json
  def create
    @user = UserFactoryService.call(
      current_user: current_user,
      created_by_user_id: current_user.id,
      **user_params.to_h.symbolize_keys
    )

    respond_to do |format|
      format.html { redirect_to edit_user_path(@user), notice: "User was successfully created" }
      format.json { render :show, status: :created, location: root_path }
    end
  rescue Net::SMTPAuthenticationError
    render(
      json: ["User was successfully created but SMTP email is not configured. Try manual password reset at #{request.base_url}#{users_password_new_path} To enable SMTP, set environment variables for SMTP_USER and SMTP_PASSWORD."],
      status: :internal_server_error
    )
  rescue StandardError => err
    render json: [err], status: :unprocessable_content
  end

  # GET /users/1/edit
  def edit
  end

  # PATCH/PUT /users/1
  # PATCH/PUT /users/1.json
  def update
    input_params = user_params.to_h.symbolize_keys
    old_email = @user.email
    if @user.update(input_params)
      if input_params[:email].present? || input_params[:name].present? || input_params[:role].present?
        # Update user info on Auth0.
        Auth0UserManagementHelper.patch_auth0_user(old_email: old_email, **input_params.slice(:email, :name, :role))
      end

      respond_to do |format|
        format.html { redirect_to edit_user_path(@user), notice: 'User was successfully updated.' }
        format.json { render :show, status: :ok, location: @user }
      end
    else
      respond_to do |format|
        format.html { render :edit }
        format.json { render json: @user.errors.full_messages, status: :unprocessable_content }
      end
    end
  end

  # POST /user/1/update_user_data
  def update_user_data
    # Unless AppConfig::AUTO_ACCOUNT_CREATION_V1 is enabled, only admins can update users.
    if !current_user.admin? && get_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1) != "1"
      render json: { message: "Nonadmin users are not allowed to modify user info" }, status: :forbidden
      return
    end

    # Non-admins can only update their own user info.
    if !current_user.admin? && current_user.id != @user.id
      render json: { message: "Users are not allowed to modify other users' info" }, status: :forbidden
      return
    end

    input_params = user_params_for_nonadmin.to_h.symbolize_keys
    old_email = @user.email
    if @user.update(input_params)
      if input_params[:email].present? || input_params[:name].present?
        # Update user info on Auth0.
        Auth0UserManagementHelper.patch_auth0_user(old_email: old_email, email: input_params[:email], name: input_params[:name], role: @user.role)
      end

      render json: { message: "User data successfully updated" }, status: :ok
    else
      respond_to do |_format|
        render json: @user.errors.full_messages, status: :unprocessable_content
      end
    end
  end

  # POST /user/1/post_user_data_to_airtable
  def post_user_data_to_airtable
    if get_app_config(AppConfig::LOCAL_USER_PROFILE) == "1"
      UserProfile.create(user_id: @user.id, **profile_params.to_h.symbolize_keys)
      render json: { message: "User data successfully saved locally" }, status: :ok
    end
    if get_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1) != "1"
      render json: { message: "AUTO_ACCOUNT_CREATION_V1 is not enabled" }, status: :forbidden
      return
    end
    profile_form_params = profile_params.to_h.symbolize_keys
    if profile_params[:profile_form_version].present?
      UsersHelper.send_profile_form_to_airtable(@user, profile_form_params)
    end
    render json: { message: "User data successfully posted to AirTable" }, status: :ok
  end

  # DELETE /users/1
  # DELETE /users/1.json
  def destroy
    @user.destroy!

    # Delete user from Auth0
    Auth0UserManagementHelper.delete_auth0_user(email: @user.email)

    respond_to do |format|
      format.html { redirect_to users_url, notice: 'User was successfully destroyed.' }
      format.json { head :no_content }
    end
  end

  # GET /users/register
  def register
  end

  # GET /users/password/new
  def password_new
    render 'password_new'
  end

  # GET /users/feature_flags
  def feature_flags
    if current_user.admin?
      render(
        json: {
          launched_feature_list: current_user.launched_feature_list,
          allowed_feature_list: current_user.allowed_feature_list,
        }.to_json,
        status: :ok
      )
    end
  end

  # POST /users/feature_flag
  def feature_flag
    if current_user.admin?
      permitted_params = params.permit(:feature_flag_action, :feature_flag, user_emails: [])
      emails = permitted_params[:user_emails]
      users_that_already_had_feature_flag = []
      users_with_no_accounts = []

      emails.each do |email|
        user = User.find_by(email: email)

        if user.nil?
          users_with_no_accounts << email
          next
        end

        if permitted_params[:feature_flag_action] == "add"
          if user.allowed_feature?(permitted_params[:feature_flag])
            users_that_already_had_feature_flag << email
            next
          end

          user.add_allowed_feature(permitted_params[:feature_flag])
        elsif permitted_params[:feature_flag_action] == "remove"
          user.remove_allowed_feature(permitted_params[:feature_flag])
        end
      end

      render(
        json: {
          featureFlagAction: permitted_params[:feature_flag_action],
          usersThatAlredyHadFeatureFlag: users_that_already_had_feature_flag,
          usersWithNoAccounts: users_with_no_accounts,
          usersWithUpdatedFeatureFlags: emails - users_that_already_had_feature_flag - users_with_no_accounts,
        }.to_json,
        status: :ok
      )
    end
  end

  # GET /users/1/export_data
  # Admin-only: triggers a streaming user-data export (per-table NDJSON bundle,
  # schema 1.0), uploads it to S3, and returns the manifest + bundle location
  # rather than the (potentially multi-GB) data. Prefer the rake task for large
  # users. Runs on the SOURCE (CZ ID) side to produce a bundle for import.
  def export_data
    # Dir.mktmpdir gives a scratch directory (auto-removed at block exit) for the
    # service to stream the bundle into before we push it to S3. We keep it
    # disk-backed rather than piping straight to S3 so the endpoint shares the
    # exact code path as the rake task (which keeps a local /mnt copy); the bundle
    # is tiny per-file and cleaned up immediately.
    Dir.mktmpdir("user_data_export") do |dir|
      result = UserDataExportService.call(user_id: params[:id], output_dir: dir)

      bucket = ENV["SAMPLES_BUCKET_NAME_V1"]
      s3_location = nil
      if bucket.present?
        prefix = "user_data_exports/#{result[:user_id]}/user_#{result[:user_id]}_export_#{Time.current.strftime('%Y%m%dT%H%M%SZ')}"
        # The bundle is already gzipped per table (<table>.ndjson.gz); we upload
        # the files individually under one S3 prefix rather than wrapping them in
        # a single .zip/.tar.gz, because a single archive needs each entry's size
        # up front, which would defeat the streaming write. The S3 "folder" is the
        # bundle.
        result[:files].each do |filename|
          S3Util.upload_file(bucket, "#{prefix}/#{filename}", File.join(dir, filename))
        end
        s3_location = "s3://#{bucket}/#{prefix}/"
      end

      render json: {
        user_id: result[:user_id],
        schema_version: result[:schema_version],
        table_counts: result[:table_counts],
        s3_location: s3_location,
        warnings: result[:warnings],
      }, status: :ok
    end
  rescue UserDataExportService::UserNotFoundError
    render json: { error: "User not found" }, status: :not_found
  rescue UserDataExportService::ExportError => e
    render json: { error: e.message }, status: :internal_server_error
  end

  # POST /users/1/initiate_s3_transfer
  def initiate_s3_transfer
    transfer_job = S3TransferDispatchService.call(@user.id)
    redirect_to users_url, notice: "Started S3 transfer for #{@user.email} (job ##{transfer_job.id}, #{transfer_job.file_count} files)."
  rescue S3TransferDispatchService::NoFilesError
    redirect_to users_url, alert: "No transferable files found for #{@user.email}."
  rescue StandardError => err
    redirect_to users_url, alert: "Failed to start S3 transfer for #{@user.email}: #{err.message}"
  end

  # GET /users/1/transfer_jobs
  def transfer_jobs
    @transfer_jobs = @user.s3_transfer_jobs.order(created_at: :desc)
  end

  private

  # Use callbacks to share common setup or constraints between actions.
  def set_user
    @user ||= User.find(params[:id])
  end

  # Never trust parameters from the scary internet, only allow the white list through.
  def user_params
    params.require(:user).permit(:role, :email, :institution, :name, :send_activation, :segments, :archetypes, :profile_form_version, project_ids: [])
  end

  def user_params_for_nonadmin
    params.require(:user).permit(:email, :name, :profile_form_version)
  end

  def profile_params
    params.require(:user).permit(:first_name, :last_name, :profile_form_version, :ror_institution, :ror_id, :country, :world_bank_income, :expertise_level, :signup_path, :newsletter_consent, czid_usecase: [], referral_source: [])
  end
end
