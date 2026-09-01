class BackgroundsController < ApplicationController
  before_action :login_required
  # `show` is intentionally NOT admin-only: any signed-in user may view the
  # details (description + member samples) of a background they are authorized
  # to see. The authorization is enforced by `set_viewable_background` below,
  # which scopes the lookup through Background.viewable(current_user).
  before_action :admin_required, except: [:create, :show, :show_taxon_dist, :index]
  before_action :set_background, only: [:destroy, :show_taxon_dist]
  before_action :set_viewable_background, only: [:show]

  # GET /backgrounds
  # GET /backgrounds.json
  def index
    permitted_params = index_params
    json_response = {}.tap do |h|
      if permitted_params[:categorizeBackgrounds]
        # Categorize backgrounds into background the user owns and all other viewable backgrounds that do not belong to the user.
        h[:other_backgrounds] = current_power.backgrounds.where.not(user: current_user).or(current_power.backgrounds.created_by_idseq).order(created_at: :desc)
        h[:owned_backgrounds] = current_power.owned_backgrounds.order(created_at: :desc)
      else
        @backgrounds = permitted_params[:ownedOrPublicBackgroundsOnly] ? current_power.owned_backgrounds.or(current_power.public_backgrounds) : current_power.backgrounds
        @backgrounds = @backgrounds.order(created_at: :desc)
        h[:backgrounds] = @backgrounds
      end
    end

    respond_to do |format|
      format.html { render :index }
      format.json { render json: json_response }
    end
  end

  # GET /backgrounds/1
  # GET /backgrounds/1.json
  #
  # Returns a background's details so a user can review what a background
  # actually is after it has been created -- its description and the exact set
  # of samples that were used to build it. Prior to this, there was no way for a
  # non-admin to see either, so a user who did not record the name/contents at
  # creation time had no way to recover them (SMP-1437).
  def show
    # Distinct samples that went into the background, eager-loading project to
    # avoid an N+1 when rendering each sample's project name.
    @samples = @background.samples.includes(:project).distinct.order(:name)
    # Whether the current user owns the background (drives edit/delete
    # affordances in the UI; ownership is required to manage a background).
    @editable = current_user.present? && @background.user_id == current_user.id
  end

  def show_taxon_dist
    # Output count_type => rpm information for specified taxid
    # Example: /backgrounds/4/show_taxon_dist?taxid=570
    taxid = params[:taxid].to_i
    ts = TaxonSummary.where(background_id: @background.id, tax_id: taxid)
    output = {}
    ts.each do |t|
      fields = t.slice(:tax_level, :mean, :stdev, :rpm_list)
      fields[:rpm_list] = JSON.parse(fields[:rpm_list])
      output[t[:count_type]] = fields
    end

    render json: output
  end

  # GET /backgrounds/new
  def new
    @background = Background.new
  end

  # GET /backgrounds/1/edit
  # NOTE -- Vince, May 2023: We do not currently support `edit` of backgrounds
  # See the related `update` for more details on this.
  # def edit
  # end

  # POST /backgrounds
  # POST /backgrounds.json
  def create
    name = params[:name]
    description = params[:description]
    sample_ids = params[:sample_ids].map(&:to_i)
    mass_normalized = params[:mass_normalized].present?

    non_viewable_sample_ids = sample_ids.to_set - current_power.samples.pluck(:id).to_set
    if !non_viewable_sample_ids.empty?
      render json: {
        status: :unauthorized,
        message: "You are not authorized to view all samples in the list.",
      }
    else
      pipeline_run_ids = Background.eligible_pipeline_runs.where(sample_id: sample_ids).pluck(:id)
      @background = Background.new(
        user_id: current_user.id,
        name: name,
        description: description,
        pipeline_run_ids: pipeline_run_ids,
        mass_normalized: mass_normalized
      )
      if @background.save
        render json: {
          status: :ok,
        }
      else
        render json: {
          status: :not_acceptable,
          message: @background.errors.full_messages,
        }
      end
    end
  end

  # PATCH/PUT /backgrounds/1
  # PATCH/PUT /backgrounds/1.json
  # NOTE -- Vince, May 2023: We do not support `update` of backgrounds.
  # In the past, we allowed a background to be updated, but it's unclear what
  # the motivation was there and the functionality wasn't used for ~5 years.
  # From a comp bio perspective, it's unclear what we would want an update
  # process to look like exactly, so we've just removed it entirely.
  # If we decide we want this functionality again in the future, you will
  # need to update `routes.rb` to remove the `except` on this aspect of the
  # resource. You may also want to re-enable `edit` method too: if so, you'll
  # also need to make a sensible `edit.html.erb` template depending on intent.
  # def update
  # end

  # DELETE /backgrounds/1
  # DELETE /backgrounds/1.json
  def destroy
    @background.destroy
    respond_to do |format|
      format.html { redirect_to backgrounds_url, notice: 'Background was successfully destroyed.' }
      format.json { head :no_content }
    end
  end

  private

  # Use callbacks to share common setup or constraints between actions.
  def set_background
    @background = Background.find(params[:id])
  end

  # Authorization for `show`. A user may only view a background they are
  # entitled to see: one they own, one all of whose underlying samples they can
  # view, or a public background (Background.viewable encodes this rule; admins
  # get everything). Scoping the lookup through `viewable` -- rather than a bare
  # Background.find -- prevents a user from reading the description or member
  # samples of a background that is not theirs.
  def set_viewable_background
    @background = Background.viewable(current_user).find_by(id: params[:id])
    return if @background.present?

    respond_to do |format|
      # Mirror the app's other not-authorized redirects (login_required /
      # admin_required both send the user to root_path) rather than leaking the
      # existence of a background the user may not view.
      format.html { redirect_to root_path }
      format.json do
        render json: {
          status: :not_found,
          message: "Background not found or you are not authorized to view it.",
        }, status: :not_found
      end
    end
  end

  def index_params
    params.permit(:ownedOrPublicBackgroundsOnly, :categorizeBackgrounds)
  end

  # Never trust parameters from the scary internet, only allow the white list through.
  def background_params
    params.require(:background).permit(:name, :ownedOrPublicBackgroundsOnly, pipeline_run_ids: [], sample_ids: [])
  end
end
