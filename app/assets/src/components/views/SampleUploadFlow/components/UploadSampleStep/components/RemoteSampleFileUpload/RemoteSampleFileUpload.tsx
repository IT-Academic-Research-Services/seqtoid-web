import { compact } from "lodash/fp";
import React from "react";
import { bulkImportRemoteSamples } from "~/api";
import List from "~/components/ui/List";
import { GlobalContext } from "~/globalContext/reducer";
import { Project } from "~/interface/shared";
import PrimaryButton from "~ui/controls/buttons/PrimaryButton";
import Input from "~ui/controls/Input";
import Notification from "~ui/notifications/Notification";
import {
  NO_TARGET_PROJECT_ERROR,
  NO_VALID_SAMPLES_FOUND_ERROR,
} from "../../../../constants";
import cs from "../../../../sample_upload_flow.scss";

interface RemoteSampleFileUploadProps {
  project?: Project;
  onChange: $TSFixMeFunction;
  onNoProject: $TSFixMeFunction;
  showNoProjectError?: boolean;
}

interface RemoteSampleFileUploadState {
  showInfo: boolean;
  remoteS3Path: string;
  lastPathChecked: string;
  error?: string;
}

export class RemoteSampleFileUpload extends React.Component<RemoteSampleFileUploadProps> {
  static contextType = GlobalContext;
  state: RemoteSampleFileUploadState = {
    showInfo: false,
    remoteS3Path: "",
    lastPathChecked: "",
  };

  componentDidUpdate() {
    if (
      this.state.error === NO_TARGET_PROJECT_ERROR &&
      this.props.project !== null
    ) {
      this.setState({
        error: "",
      });
    }
  }

  toggleInfo = () => {
    this.setState({
      showInfo: !this.state.showInfo,
    });
  };

  handleRemotePathChange = (remoteS3Path: string) => {
    this.setState({
      remoteS3Path,
    });
  };

  handleConnect = async () => {
    if (!this.props.project) {
      this.setState({
        error: NO_TARGET_PROJECT_ERROR,
      });
      this.props.onNoProject();
      return;
    }

    // Trim before sending: S3 bucket names cannot start or end with a space, so a
    // stray leading/trailing space (common from copy-paste) produces an invalid
    // bucket and the import fails. Normalize the displayed value too so the user
    // sees the path that was actually checked.
    const remoteS3Path = this.state.remoteS3Path.trim();

    this.setState({
      error: "",
      remoteS3Path,
      lastPathChecked: remoteS3Path,
    });

    try {
      let newSamples = await bulkImportRemoteSamples({
        projectId: this.props.project.id,
        hostGenomeId: "",
        bulkPath: remoteS3Path,
      });

      // Remove any nil files from input_files_attributes.
      // This happens when there is an R2 file without an R1 file.
      newSamples = newSamples.samples.map((sample: $TSFixMe) => ({
        ...sample,
        input_files_attributes: compact(sample.input_files_attributes),
      }));

      this.props.onChange(newSamples);
    } catch (e) {
      // The API layer (toApiError in api/core.ts) leaves the parsed Rails body on
      // e.response.data, so the actionable message bulk_import returns -- `{ status: ... }`
      // for a bad path, a missing bucket, or an access-denied that means our upload account
      // lacks read permission on that bucket -- lives at e.response.data.status. The old check
      // read e.data.status, which is always undefined here, so this branch never fired and
      // EVERY failure fell through to the generic "unexpected error with status code" below
      // (this is what showed a bare "status code: 422" for a cross-account permission gap).
      // Read both paths so the specific backend message reaches the user.
      const backendMessage = e?.response?.data?.status ?? e?.data?.status;
      if (backendMessage) {
        this.setState({ error: backendMessage });
      } else if (e.status) {
        this.setState({
          error: `Encountered an unexpected error with status code: ${e.status}`,
        });
      } else {
        // Otherwise fallback to a generic error message
        this.setState({ error: NO_VALID_SAMPLES_FOUND_ERROR });
      }
    }
  };

  render() {
    return (
      <div className={cs.remoteFileUpload}>
        <div className={cs.label}>
          Path to S3 Bucket
          <span className={cs.infoLink} onClick={this.toggleInfo}>
            {this.state.showInfo ? "Hide" : "More"} Info
          </span>
        </div>
        {this.state.showInfo && (
          <div className={cs.info}>
            <div className={cs.title}>S3 Bucket Instructions</div>
            <List
              listItems={[
                `Please ensure that SeqtoID has permissions to read/list your S3
                bucket. Contact us for help getting set up.`,
                `Also convert links like
                "https://s3-us-west-2.amazonaws.com/your_s3_bucket/rawdata/fastqs"
                to the format "s3://your_s3_bucket/rawdata/fastqs"`,
              ]}
            />
            <div className={cs.title}>File Instructions</div>
            <List
              listItems={[
                <>
                  Accepted file formats:
                  <List
                    listItems={[
                      `Metagenomics: fastq (.fq), fastq.gz (.fq.gz), fasta (.fa), fasta.gz (.fa.gz).`,
                      `Consensus Genome: fastq (.fq).`,
                    ]}
                  />
                </>,
                `Paired files must be labeled with "_R1" or
                "_R2" at the end of the basename.`,
                `File names must be no longer than 120 characters and can only
                contain letters from the English alphabet (A-Z, upper and lower
                case), numbers (0-9), periods (.), hyphens (-) and underscores
                (_). Spaces are not allowed.`,
              ]}
            />
          </div>
        )}
        <div className={cs.controls}>
          <Input
            fluid
            placeholder="Ex: s3://your_s3_bucket/rawdata/fastqs"
            className={cs.input}
            value={this.state.remoteS3Path}
            onChange={this.handleRemotePathChange}
          />
          <PrimaryButton
            className={cs.connectButton}
            rounded={false}
            text="Connect to Bucket"
            disabled={
              this.state.remoteS3Path === "" ||
              this.state.remoteS3Path === this.state.lastPathChecked
            }
            onClick={this.handleConnect}
          />
        </div>

        {this.state.error && (
          <Notification
            type="error"
            displayStyle="flat"
            className={cs.notification}
          >
            {this.state.error}
          </Notification>
        )}
      </div>
    );
  }
}
