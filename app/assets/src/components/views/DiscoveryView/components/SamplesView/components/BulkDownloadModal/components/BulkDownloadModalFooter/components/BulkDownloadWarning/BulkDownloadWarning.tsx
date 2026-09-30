import React from "react";
import AccordionNotification from "~/components/ui/notifications/AccordionNotification";
import cs from "./bulk_download_warning.scss";

interface BulkDownloadWarningProps {
  message: string;
  sampleNames: string[];
  // The number of samples the header should report. Defaults to the number of
  // listed sampleNames, but callers may pass an explicit count when the listed
  // names are a summarized view (e.g. an appended "...and N more" row) so the
  // header stays accurate.
  count?: number;
}

export const BulkDownloadWarning = ({
  message,
  sampleNames,
  count,
}: BulkDownloadWarningProps) => {
  const sampleCount = count ?? sampleNames.length;
  return (
    <AccordionNotification
      header={
        <div>
          <span className={cs.highlight}>
            {sampleCount} sample
            {sampleCount > 1 ? "s" : ""} won&apos;t be included in the bulk
            download
          </span>
          {message}
        </div>
      }
      content={
        <span>
          {sampleNames.map((name, index) => {
            return (
              <div key={index} className={cs.messageLine}>
                {name}
              </div>
            );
          })}
        </span>
      }
      open={false}
      type={"warning"}
      displayStyle={"flat"}
    />
  );
};
