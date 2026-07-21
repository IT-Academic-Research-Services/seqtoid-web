import React from "react";
import { Footer } from "~/components/common/Footer";
import { LandingHeader } from "~/components/common/LandingHeader";
import { NarrowContainer } from "~/components/layout";
import { LAST_UPDATED_DATE } from "~/components/views/legalConstants";

const PRIVACY_STYLES = `
  .privacy-notice-page { padding: 48px 0 64px; }
  .privacy-notice-table-wrap { overflow-x: auto; margin: 24px 0; }
  .privacy-notice-table { width: 100%; border-collapse: collapse; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .privacy-notice-table thead tr { background-color: #052049; color: #ffffff; }
  .privacy-notice-table th { padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; text-align: left; }
  .privacy-notice-table td { padding: 12px 16px; font-size: 14px; vertical-align: top; border-bottom: 1px solid #e2e8f0; }
  .privacy-notice-row-group td { background: #f0f7ff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #052049; padding: 8px 16px; }
  .privacy-notice-legal-body h2 { font-size: 20px; font-weight: 700; color: #052049; margin: 32px 0 12px; }
  .privacy-notice-legal-body h3 { font-size: 16px; font-weight: 600; color: #052049; margin: 24px 0 8px; }
  .privacy-notice-legal-body p { font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 16px; }
  .privacy-notice-legal-body ul { padding-left: 24px; margin-bottom: 16px; }
  .privacy-notice-legal-body li { font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 8px; }
  .privacy-notice-title { font-size: 28px; font-weight: 700; color: #052049; margin-bottom: 8px; }
  .privacy-notice-updated { font-size: 13px; color: #6b7280; margin: 0 0 24px; }
  .privacy-notice-updated a { color: #006BE9 !important; text-decoration: none; }
  .privacy-notice-updated a:hover { text-decoration: underline; }
  /* !important overrides the global \`a { color: inherit !important }\` in _header.scss (same pattern as support.scss). */
  .privacy-notice-legal-body a { color: #006BE9 !important; text-decoration: none; }
  .privacy-notice-legal-body a:hover { text-decoration: underline; }
`;

export const PrivacyNotice = () => {
  return (
    <>
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: PRIVACY_STYLES }}
      />
      <LandingHeader legalNav />
      <NarrowContainer size="small" className="privacy-notice-page">
        <div className="privacy-notice-legal-body">
        <h1 className="privacy-notice-title">Privacy Policy</h1>
        <p className="privacy-notice-updated">
          Last Updated: {LAST_UPDATED_DATE} &middot;{" "}
          <a href="/terms_changes">See Recent Changes</a>
        </p>
        <p>The SeqToID platform (&quot;SeqToID&quot; or the &quot;Services&quot;) is owned by The Regents of the University of California and operated by the University of California, San Francisco (UCSF) (together, &quot;UCSF&quot;, &quot;we&quot;, &quot;us&quot; or &quot;our&quot;). This privacy notice (&quot;Privacy Notice&quot;) describes the types of information we collect or that is uploaded by website visitors (&quot;Visitors&quot;) and registered users (&quot;Users&quot;), and how we use, disclose, and protect that information.</p>

        <p>UCSF operates SeqToID to support public-health surveillance, scientific research, and responsible data sharing. In line with international public-health guidance (including World Health Organization data-sharing principles), our approach emphasizes: (a) timely sharing for public-health action, (b) equitable recognition of data contributors, (c) protection of privacy and confidentiality, (d) transparent governance of data use, and (e) legal and regulatory compliance. These principles guide how we store, share, and grant access to data.</p>

        <p>For ease of understanding, we&apos;ve created the below Summary Table, which pulls out some key points. More details can be found in the full Privacy Notice below and in the <a href="/terms">Terms of Use</a> (&quot;Terms&quot;) that apply to your use of SeqToID.</p>

        <h2>Summary Table</h2>

        <div className="privacy-notice-table-wrap">
          <table className="privacy-notice-table">
            <colgroup>
              <col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>Type of Data</th>
                <th>What is it?</th>
                <th>What&apos;s it used for?</th>
                <th>How is it shared?</th>
                <th>Your Choices</th>
              </tr>
            </thead>
            <tbody>
              <tr className="privacy-notice-row-group">
                <td colSpan={5}>Data you upload to or create using SeqToID</td>
              </tr>
              <tr>
                <td><strong>Raw Sample Data</strong></td>
                <td>Genetic sequence files (ex: FASTA/FASTQ) uploaded by Users.</td>
                <td>Upon upload, Raw Sample Data is processed through our data pipeline and all host (ex: human, mosquito) genetic information is filtered out in order to generate Reports. We filter out all human genetic information, regardless of host. We use the remaining data, with Sample Metadata, to create Reports and Visualizations showing the microorganisms in your sample. These Reports and Visualizations can be shared with other SeqToID users.</td>
                <td>Raw Sample Data is not shared with any other SeqToID user, nor is it ever accessed by anyone working on SeqToID unless specifically requested by a User, such as to debug an issue. This data is disclosed to our service providers (ex: AWS) in order to operate and secure the service.</td>
                <td>Raw Sample Data will not be stored by SeqToID.</td>
              </tr>
              <tr>
                <td><strong>Sample Metadata</strong></td>
                <td>Data about Samples annotated by Users (ex: sequencer used, sample collection date).</td>
                <td>See above.</td>
                <td>Report Data and Visualizations that Users create can include Sample Metadata. SeqToID Users may choose to share that Report Data and/or Visualizations (including Sample Metadata) with other SeqToID Users.<br /><br />This data is also shared with service providers (ex: AWS) that help operate, improve, and secure SeqToID. Service providers will not use any data shared with them for any purpose beyond operating, improving, and securing SeqToID.<br /><br />We will never sell your data or share it with anyone that does.</td>
                <td></td>
              </tr>
              <tr>
                <td><strong>Report Data</strong></td>
                <td>Data about non-host microorganisms that may be contained in the uploaded sample (includes Sample Metadata).</td>
                <td>See above.</td>
                <td>See above.</td>
                <td></td>
              </tr>
              <tr>
                <td><strong>Visualizations</strong></td>
                <td>Analyses created by Users based on Report Data (ex: heatmaps and phylogenetic trees). Can include Sample Metadata.</td>
                <td>See above.</td>
                <td>See above.</td>
                <td></td>
              </tr>
              <tr className="privacy-notice-row-group">
                <td colSpan={5}>Data SeqToID collects</td>
              </tr>
              <tr>
                <td><strong>User Data</strong></td>
                <td>Data about researchers with SeqToID accounts such as name, email, institution, basic information about how they are using SeqToID (ex: search queries), and information provided through surveys, during an in-person event, or for user support (ex: resolving support requests).</td>
                <td>We use this data only to operate, secure, and improve the SeqToID services.</td>
                <td>Basic SeqToID account information such as name and institution may be visible to other SeqToID Users (ex: with collaborators on a shared project).<br /><br />This data is also shared with service providers (ex: AWS) that help operate, improve, and secure SeqToID.<br /><br />Service providers will not use any data shared with them for any purpose beyond operating, improving, and securing SeqToID.<br /><br />We will never sell your data or share it with anyone that does.</td>
                <td>Users can request deletion of their SeqToID account data by contacting us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> and we will fulfill the request within the timelines set forth under applicable privacy laws. You can learn more about your choices in the Section titled, &quot;Choices About Your Data.&quot;</td>
              </tr>
              <tr>
                <td><strong>Device and Analytics Data</strong></td>
                <td>Device Data (ex: browser type, operating system, and IP address) and Analytics Information (ex: links within SeqToID you click on and how often you log into SeqToID) includes basic information about how Users and Visitors are interacting with SeqToID and a general location (i.e. country) of where they are accessing the Services.</td>
                <td>See above.</td>
                <td>See above.</td>
                <td></td>
              </tr>
              <tr>
                <td><strong>Visitor Data</strong></td>
                <td>Data about visitors (non-Users) to SeqToID pages, and includes basic analytics information (ex: links clicked).</td>
                <td>See above.</td>
                <td>See above.</td>
                <td>This data is not personally identifiable.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>About SeqToID</h2>

        <p>SeqToID is an online platform designed to enable the research community to research pathogens in metagenomic sequencing and to help further the study of infectious diseases. To do this, SeqToID processes genetic data in order to identify pathogens contained within.</p>

        <p>UCSF aims to facilitate rapid, responsible sharing of pathogen information to support global health responses. Where appropriate and consistent with applicable law, funder requirements, and user choices, SeqToID enables expedited sharing of pathogen reports to public-health authorities and registered researchers to inform surveillance and response.</p>

        <p>Here&apos;s how SeqToID works: Users submit Upload Data (as described below). This data may contain human and non-human genetic sequences (&quot;Raw Sample Data&quot;; as further defined below), as well as information about those sequences, such as the date the sample was collected and the host species it was collected from (&quot;Sample Metadata&quot; as further defined below). For example, a researcher might upload genetic information from mosquitoes, which are often a source of infectious disease, or from humans, who can be infected by such diseases. SeqToID then processes this Upload Data in order to identify pathogens found within the genetic sequence (e.g., the mosquito may be carrying the chikungunya virus).</p>

        <p>We hope that this sharing of pathogen data will help to create a global dashboard that helps researchers better understand pathogens.</p>

        <p>When uploading data, contributors may choose a sharing level for the resulting Report Data and Sample Metadata:</p>
        <ul>
          <li><strong>Public release</strong> — Report Data and associated Sample Metadata are openly visible to all SeqToID users and may be indexed externally;</li>
          <li><strong>Restricted release</strong> — Report Data and Sample Metadata are accessible to registered researchers under controlled access;</li>
          <li><strong>Private</strong> — Report Data is visible only to the contributor and to UCSF for operational/quality purposes.</li>
        </ul>

        <p>Contributors may change sharing choices post-upload where technically feasible, subject to any legal, contractual, or public-health exceptions. In public-health emergency situations, UCSF may implement expedited sharing in accordance with applicable laws, funder requirements, and public-health guidance.</p>

        <p>SeqToID also collects information about Users in order to offer and improve the Service. Other than basic information required to create an account (e.g. email address, name), the User determines what information they want to upload onto SeqToID. Please note: SeqToID is not designed for or directed toward children under the age of sixteen and we do not have actual knowledge that we have sold or shared the personal information of SeqToID users under 16 years of age. If we become aware that we have the information of such children collected through SeqToID, we will promptly delete it.</p>

        <h2>Data SeqToID Collects</h2>

        <p>We will never share your personal information for behavioral advertising purposes nor will we ever sell your personal information. We do collect, use, and retain your data as follows:</p>

        <h2>1. Upload Data.</h2>

        <p>&quot;Upload Data&quot; is data that Users upload to SeqToID (other than the information Users provide during registration to create an account). As explained below, Upload Data consists of genetic sequence information (human or non-human) and metadata about those genetic sequences (such as time and location of sample collection).</p>

        <p>As described in our Terms, Users are required to obtain and maintain all necessary consents, permissions, and authorizations required by applicable laws prior to uploading, sharing, and exporting Upload Data with the Services.</p>

        <h3>What Is Upload Data?</h3>

        <p>Upload Data includes Raw Sample Data and Sample Metadata.</p>

        <p><strong>Raw Sample Data:</strong> &quot;Raw Sample Data&quot; is full genetic sequence data uploaded by Users (i.e. FASTA or FASTQ files). Genetic sequence data contains genetic information about pathogens in the sample and of the host from which the sample was taken. The host could be a human or non-human (e.g., mosquito). Host genetic information is filtered out in order to generate Reports, so Report Data should not contain any human sequence data.</p>

        <p><strong>Sample Metadata:</strong> &quot;Sample Metadata&quot; includes information related to the Raw Sample Data, such as the host type (e.g., human or mosquito), upload date, and tissue type and free-text research notes entered by Users. This data should not include personally-identifying information regarding the individual to whom the Raw Sample Data relates.</p>

        <h3>Sensitive Personal Information</h3>

        <p>Raw Sample Data a User uploads from a human host is sensitive personal information (genetic sequence data) and we collect this information to operate and provide the requested service to you.</p>

        <h3>How We Use Upload Data</h3>

        <p>Upload Data is used for the following business purposes:</p>
        <ul>
          <li>To create Report Data (described below).</li>
          <li>To improve the way SeqToID creates Report Data, including improving our Data Pipeline.</li>
          <li>To debug in the event you reach out to us with a specific issue related to your Upload Data.</li>
        </ul>
        <p>We will never sell your Upload Data or share it with anyone that does nor will we share your personal information for behavioral advertising purposes.</p>

        <h3>How We Share Upload Data</h3>

        <p>Raw Sample Data is never disclosed to any other SeqToID User other than the User that uploaded the sample, but it is disclosed to service providers in order to provide the Services, such as AWS for data storage. Even staff working on SeqToID cannot access this information except as specifically instructed by a User, such as to debug an issue.</p>

        <p>In order to advance SeqToID&apos;s goal of creating a global pathogen dashboard for researchers, Users will have the option (at their discretion) to share Report Data and Sample Metadata with all SeqToID Users. Users can also choose to share their Report Data by creating Projects (groups of Reports) and sharing those Projects with other SeqToID Users.</p>

        <p>If you have questions about how to share your Report Data and Sample Metadata, then please reach out to <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.</p>

        <h2>2. Report Data.</h2>

        <p>Report Data is information SeqToID produced from Upload Data. We generate Report Data by processing Upload Data through our Data Pipeline. The &quot;Data Pipeline&quot; cleans (e.g., by removing duplicate nucleotides) and analyzes (e.g., by matching Raw Sample Data nucleotide sequences with known pathogen sequences) the Upload Data. Report Data may include, for example, data about the pathogen sequences identified in the Raw Sample Data and the frequency of such identification (&quot;Pathogen Data&quot;) or raw numeric counts of non-personally identifying gene expression profiles that were found in the Raw Sample Data (&quot;Gene Counts&quot;).</p>

        <p>Once Raw Sample Data has been put through the Data Pipeline, the Report Data that is produced no longer includes any human genetic sequence data, is not personal data, and does not, on its own, permit association with any specific individual. If you are able to find human sequence data in any Reports in SeqToID, please let us know at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> and we will address it.</p>

        <p>UCSF acts as steward of processed outputs (Report Data) required for platform operation, quality assurance, research, and public-health use. Users retain ownership of their underlying Upload Data. UCSF will delete Raw Sample Data (e.g., FASTQ) after processing and will not retain access to such data. Users retain the right to publish or otherwise use their data.</p>

        <h3>Who can see Report Data?</h3>

        <p>As mentioned above in Section 1 (How We Disclose Upload Data), Users can choose to share their Report Data by creating Projects (groups of Reports) and share those Projects with specific other SeqToID Users (&quot;Restricted Release&quot;) or Users can decide to share it more broadly with all SeqToID Users by marking a Project as &quot;Public&quot; (&quot;Public Release&quot;). This does not include Raw Sample Data.</p>

        <p>Users also may have the option to share their Report Data with certain third party tools, like Nextclade. You control whether to use this integration or not. If you do, we will collect basic information about your use of that integration, such as how often you use it.</p>

        <h2>3. Visitor and User Data.</h2>

        <p>Visitor and User Data is the information we collect from you and your use of SeqToID.</p>

        <h3>What We Collect</h3>

        <p><strong>Visitor Data.</strong> This is information collected from visitors to our website, whether or not they are Users (&quot;Visitor Data&quot;).</p>

        <p><strong>User Data.</strong> User Data is any information we collect from a User about that User such as identifiers and professional or employment-related information (&quot;User Data&quot;). It may include information necessary to create or access your account such as your name, username, email address, and login credentials. This could also include information we collect if you decide to respond to a voluntary survey or join us for an in-person event.</p>

        <p><strong>Device and Analytics Data.</strong> When Visitors and Users visit or use our Service, we may automatically collect Device Data or Analytics Information which includes internet or other electronic network activity and geolocation data. &quot;Device Data&quot; includes information about your browser type and operating system, IP address and/or device ID, including basic analytics from your device or browser. &quot;Analytics Information&quot; relates to any of your requests, queries, or use of the Services, such as the amount of time spent viewing particular web pages. We use service providers for this service.</p>

        <p><strong>Cookies, Web Beacons, and other Technologies.</strong> A cookie is a small file that may be stored on your computer or other device. Web beacons and similar technologies are small bits of code embedded in web pages or an email, for example, that communicate with third parties. We use these technologies to recognize your device and browser and do things such as keep you logged in or to understand usage patterns by Users and Visitors to our Services. We do not use cookies to serve third party ads.</p>

        <h3>How We Use That Data</h3>

        <p>Visitor Data and User Data (including any personal data in the Visitor Data or User Data) is used for the following business purposes:</p>
        <ul>
          <li>To identify you, create a profile for Users, and verify User&apos;s identity so you can log in to and use SeqToID.</li>
          <li>To provide you with notices about your account and updates about SeqToID.</li>
          <li>To respond to your inquiries and requests.</li>
          <li>To learn about what Users find valuable with SeqToID, to analyze how Users are using SeqToID, and to learn the general location (i.e., country) of where Users are accessing the Service so we can optimize and improve it.</li>
          <li>To protect the security and integrity of SeqToID.</li>
        </ul>

        <h2>4. How Long We Retain Data and Data Deletion.</h2>

        <p>We retain your personal data as long as is reasonably necessary:</p>
        <ul>
          <li>Raw Sample Data is deleted promptly after it is processed by our Data Pipeline.</li>
          <li>Sample Metadata and Report Data are retained until Users delete it from SeqToID. Users may submit deletion requests by emailing <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> and we will delete the requested Report Data (including Sample Metadata) within the timelines set forth under applicable privacy laws.</li>
          <li>User Data is retained until Users close their SeqToID account as such data is required to manage the service. Users may submit a request for account closure by emailing <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>. We will delete your data within 60 days following the close of your account.</li>
        </ul>
        <p>Please note that we do not control, and so cannot delete, personal data that Users have copied outside of SeqToID.</p>

        <h2>5. Vendors and Service Providers.</h2>

        <p>We disclose Upload Data, Report Data, Visitor Data, and User Data to service providers, such as Amazon Web Services and ServiceNow. We may also share Visitor and User data with analytics vendors that assist us to improve and optimize SeqToID. To learn more about our vendors we use, please contact us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.</p>

        <p>If we can no longer keep operating SeqToID or believe that its purpose is better served by having another entity operating it, we will transfer SeqToID and all data existing therein (Upload Data, Report Data, Visitor Data, and User Data) so that the Users can continue to be served. We will always let you know before this happens, and you will have the option to delete your account and any data you&apos;ve uploaded prior to any such transfer. Should this occur, the entity to which we transfer your data will be obliged to use it in a manner that is consistent with this Privacy Notice and the Terms.</p>

        <p>We may disclose Upload Data, Report Data, Visitor Data, and/or User Data if we believe in good faith that such disclosure is necessary (a) in connection with any legal investigation; (b) to comply with relevant laws or to respond to subpoenas or warrants served on us; (c) to protect or defend our rights or property or those of Users; and/or (d) to investigate or assist in preventing any violation or potential violation of the law, this Privacy Notice, or our Terms.</p>

        <h2>6. How We Protect the Information.</h2>

        <p>We use industry standard security measures to ensure the confidentiality, integrity and availability of data uploaded into SeqToID. This includes practices like encrypting connections to SeqToID using TLS, hosting SeqToID on leading cloud providers with robust physical security, and ensuring that access to any personal data within SeqToID by staff working on the tool is strictly limited. And as mentioned above, Raw Sample Data is not shared with anyone other than the User that uploaded the Sample or the service providers necessary to operate the service. Even staff working on SeqToID cannot access this information except as specifically instructed by a User, such as to debug an issue.</p>

        <p>Security takes ongoing work and we will continue to monitor and adjust our security measures as SeqToID develops. Please notify us immediately at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> if you suspect your account has been compromised or are aware of any other security issues relating to SeqToID.</p>

        <h2>7. Choices About Your Data.</h2>

        <p>If you are a User, you have the following choices and rights:</p>
        <ul>
          <li>Users are able to request the deletion of User Data that constitutes their personal data or Raw Sample Data that they submitted to SeqToID.</li>
          <li>Users are able to access and download Report Data relating to Upload Data they submitted within SeqToID.</li>
          <li>Users may also object to the processing of User Data in certain circumstances by emailing <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>. In such cases, we will stop processing that data unless we have legitimate grounds to continue processing it — for example, it is needed for legal reasons.</li>
          <li>Users can also contact us by emailing <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> should they wish to access, restrict the processing of, or rectify their User Data.</li>
        </ul>

        <p>If a User has submitted Upload Data containing your personal data, please see below:</p>

        <p>We require Users who submit Upload Data to ensure they have all necessary consents, permissions, and authorizations to do so. We are unable to relate Upload Data to identifiable individuals and so cannot directly process requests from persons whose personal sequencing data may be contained in Upload Data. As a result, SeqToID is able to receive access, restriction, rectification, objection, or deletion requests only from Users.</p>

        <p>If you believe your information has been uploaded to SeqToID, you should contact the researcher or User that uploaded this information to (i) request access to the information, (ii) object to the processing of the information, or (iii) seek deletion, restriction, or rectification of the information. Similarly, if you previously provided consent to a researcher or User, you may have the right to withdraw that consent. You should contact the researcher or User to make such a withdrawal or otherwise exercise your rights.</p>

        <p>Please contact us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> if you would like to exercise the privacy choices discussed above or if you have any questions. We may ask for additional information that allows us to reasonably verify that you are the person about whom we collected personal information. If you would like an authorized agent to make a request for you, have that agent email <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> with information that is sufficient for us to verify that the authorized agent is acting on your behalf. If you would like to appeal a decision with respect to a request to exercise any of these rights, please email us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a> and explain the basis for your appeal. If your data is subject to the EU data protection law (e.g., GDPR) and you wish to raise a concern about our use of your information (and without prejudice to any other rights you may have), you have the right to do so with your local supervisory authority or by emailing us at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.</p>

        <h2>8. Do Not Track Signals.</h2>

        <p>We don&apos;t share personal data with third parties for their direct marketing purposes or behavioral advertising and never will, nor do we support any Do Not Track signals since there&apos;s currently no standard for how online services respond to those signals. As standards develop, we may establish policies for responding to DNT signals that we would describe in this Privacy Notice. You can learn more about DNT <a href="https://allaboutdnt.com/" target="_blank" rel="noopener noreferrer">here</a>.</p>

        <h2>9. Data Transfers.</h2>

        <p>SeqToID is a global service. By using SeqToID, Users authorize us to transfer and store the uploaded data outside of your home country, including to the United States, for the purposes described in this Privacy Notice.</p>

        <p>If you want to use SeqToID, you must first agree to our Terms, which set out the contract between SeqToID and our Users. We use technical infrastructure in the United States to deliver the Services to you. In accordance with the contract between us and our Users, we need to transfer personal data to the United States and to other jurisdictions as necessary to provide the Services. Such transfers are necessary for important reasons of public interest, namely global health and providing information which can be used by researchers to better understand the spread of infectious diseases. Please note that the privacy protections and the rights of authorities to access your information in these countries may not be the same as in your home country.</p>

        <h2>10. External Links.</h2>

        <p>We may link to another company&apos;s website (e.g., Nextclade as mentioned above), which may have different policies than us. We aren&apos;t responsible for their policies or content so we recommend you read their policies if you decide to use their service.</p>

        <h2>11. How to Contact Us.</h2>

        <p>If you have any questions, comments, or concerns with this Privacy Notice, you may contact us by email at <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.</p>

        <h2>12. Changes to This Privacy Notice.</h2>

        <p>This Privacy Notice was last updated on June 4, 2026. We may update this Privacy Notice from time to time and will provide you with notice of any material updates before they become effective.</p>
      </div>
      </NarrowContainer>
      <Footer />
    </>
  );
};

export default PrivacyNotice;
