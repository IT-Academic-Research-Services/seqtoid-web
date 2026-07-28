module Queries
  module Concerns
    # Authorizes a public snapshot-share ("/pub/:share_id") read in the GraphQL layer, mirroring
    # SnapshotSamplesController#set_snapshot_sample.
    #
    # A shared-link viewer is unauthenticated, so `current_power` is empty
    # (Sample.viewable(nil) == Sample.none). The SampleView report page fires several queries that
    # accept snapshotLinkId -- SampleForReport, SampleMetadata, MetadataFields -- but they ignored
    # it and loaded via current_power, so every shared sample / consensus-genome report 500'd with
    # RecordNotFound (SMP-1457, regressed by the SampleView GraphQL migration). Authorize via the
    # SnapshotLink instead: ONLY samples explicitly pinned in the snapshot's content are readable,
    # and ONLY while snapshot sharing is enabled. Fails closed on every other path.
    module SnapshotSampleAuthorization
      extend ActiveSupport::Concern
      include AppConfigHelper

      # Sample ids (Integer) pinned in the snapshot. Raises (fail-closed) if sharing is disabled or
      # the share id is unknown/malformed. Never touches current_power -- this is the public path.
      def snapshot_shared_sample_ids(snapshot_link_id)
        unless get_app_config(AppConfig::ENABLE_SNAPSHOT_SHARING) == "1"
          raise GraphQL::ExecutionError, "Snapshot sharing is not enabled."
        end

        snapshot = SnapshotLink.find_by(share_id: snapshot_link_id)
        raise GraphQL::ExecutionError, "Snapshot share not found." if snapshot.nil?

        # content: {"samples": [{"1": {"pipeline_run_id": 123}}, {"2": {...}}], ...}
        content = JSON.parse(snapshot.content)
        Array(content["samples"]).flat_map { |entry| entry.keys.map(&:to_i) }
      rescue JSON::ParserError
        raise GraphQL::ExecutionError, "Snapshot share is malformed."
      end

      # The subset of the requested ids that are pinned in the snapshot. Raises (fail-closed) if
      # NONE are shared, so an all-unshared request can never fall through to an empty/unscoped read.
      def snapshot_authorized_sample_ids(rails_sample_ids, snapshot_link_id)
        shared_ids = snapshot_shared_sample_ids(snapshot_link_id)
        wanted = Array(rails_sample_ids).map(&:to_i).select { |id| shared_ids.include?(id) }
        if wanted.empty?
          raise GraphQL::ExecutionError, "Requested sample(s) are not part of this snapshot share."
        end

        wanted
      end

      # Load one sample that MUST be pinned in the snapshot. Fails closed if the requested id is not
      # part of the share, so a shared link can never be used to read a sample it does not include.
      def snapshot_authorized_sample(rails_sample_id, snapshot_link_id)
        Sample.find(snapshot_authorized_sample_ids([rails_sample_id], snapshot_link_id).first)
      end
    end
  end
end
