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
  TRANSIENT_UPLOAD_SERVICE_ERROR,
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

    this.setState({
      error: "",
      lastPathChecked: this.state.remoteS3Path,
    });

    try {
      let newSamples = await bulkImportRemoteSamples({
        projectId: this.props.project.id,
        hostGenomeId: "",
        bulkPath: this.state.remoteS3Path,
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
        // No backend message and no HTTP status means the request never got a response
        // (transient network drop, mid-deploy restart, request aborted in flight). The
        // backend now returns an actionable `{ status }` body for EVERY genuine failure --
        // including a real empty/misnamed path ("found no valid FASTQ files") -- so this
        // branch is NEVER a data problem. Report the transient/connectivity failure
        // honestly instead of the misleading "No valid samples were found." (SMP-1725).
        //
        // Also clear lastPathChecked so the "Connect to Bucket" button re-enables for the
        // same path: this is a retry affordance for the transient case, since the button is
        // otherwise disabled while remoteS3Path === lastPathChecked and the user would have
        // had to edit an already-correct path just to try again.
        this.setState({
          error: TRANSIENT_UPLOAD_SERVICE_ERROR,
          lastPathChecked: "",
        });
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
