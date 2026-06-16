This is a Ruby on Rails application with React as the frontend. It leverages the resque gem for background jobs, and interacts with AWS infrastructure (deployed via [insert GH repo here]) through AWS sdk gems, primarily for running resource-intensive backend genome processing pipelines. 

## Project Structure
This application follows the standard Ruby on Rails model-view-controller convention for its package structure.

**[/app/](../app/)** - contains the actual Rails application code, including all controllers, models, and views  
**[/app/assets/](../app/assets/)** - contains frontend assets, such as javascripts, css, and graphics  
**[/app/assets/src/](../app/assets/src/)** - contains the React components  
**[/app/controllers/](../app/controllers/)** - contains the controllers, which provide the backend logic for processing requests, managing models, and rendering views  
**[/app/models/](../app/models/)** - contains the models, which define the data structure for objects used by the application and stored in the database  
**[/app/views/](../app/views/)** - contains the views, which are the front-end pages rendered to users of the application. These are primarily rendered React components.  
**[/app/jobs/](../app/jobs/)** - contains the background jobs run by resque. These are run on separate workers in order to isolate them from the web application.  
**[/app/services/](../app/services/)** - contains services, which are ruby files for executing logic that is not tied to a specific controller action.  
**[/app/helpers/](../app/helpers/)** - contains helper methods, which are similar to services but for reusable front-end Ruby logic.  
**[/app/lib/](../app/lib/)** - contains mainly utility classes, similar to helpers but focused on reusable backend Ruby logic.

**[/config/](../config/)** - contains the Rails configuration files for initialization and environment-specific settings  
**[/db/](../db/)** - contains the database schema, migrations (run to make in-place modifications to the database), and seeds (run to populate the database with initial data)  

**[/.github/workflows](./.github/workflows/)** - contains the GitHub Actions workflow files for CI/CD  
**[/bin/](../bin/)** - contains a mixture of local setup scripts, deploy time scripts, and adhoc scripts.  
_Recommend separating these out for improved clarity.  
e.g. bin/bundle, bin/rails, bin/rake, stay at root, bin/local-scripts for local setup, bin/deploy-scripts for deploy time, bin/adhoc-scripts for adhoc_

**[/test/](../test/)** - contains the suite of legacy minitest unit tests. Retained for coverage but not for any new tests.  
**[/spec/](../spec/)** - contains the suite of rspec tests for the application, which are unit/functional tests.  
**[/e2e/](../e2e/)** - contains the suite of end-to-end tests, which leverage Playwright to run tests against the running application (either locally or deployed to staging).  
**[/jest/](../jest/)** - contains the suite of jest tests for the application, which test the frontend React/Javascript code. _The only test in here is to test bulk download frontend functionality._


## Key Files

**[/app/views/layouts/application.html.erb](../app/views/layouts/application.html.erb)** - contains the main layout for the all pages rendered by the application. Includes HTML metadata and universal javascripts.  
**[/config/resque_schedule.yml](../config/resque_schedule.yml)** - contains the schedule for scheduled resque jobs. _NOTE: adhoc resque jobs are run in the ruby code through invocations to Resque.enqueue(JobName, args)_  
**[/config/routes.rb](../config/routes.rb)** - contains the routes for the application, which define which URLs are handled by which controllers actions.  
**[Gemfile](../Gemfile)** - contains the list of gems (external Ruby packages) used by the application.  
**[Makefile](../Makefile)** - the file used to build the application locally, primarily through first establishing necessary prerequisites (mainly scripts in /bin) executing `docker compose` to create Docker images.  
**[docker-compose.yml](../docker-compose.yml)** - the Docker file used to build the application container locally, executed through the Makefile.

## Additional Components & Integrations

### Shoryuken (Free)
[Shoryuken](https://github.com/ruby-shoryuken/shoryuken) is a message processing system for interacting with AWS SQS queues. It is only used by the [HandleSfnNotifications](../app/jobs/handle_sfn_notifications.rb) job for processing Step Functions notifications. In addition to being specified in the job class itself, the queue to be polled is also specified in the [config/shoryuken.yml](../config/shoryuken.yml) file.

### Resque (Free)
[Resque](https://github.com/resque/resque) is a system for processing background jobs. Any of the jobs in the [app/jobs](../app/jobs) directory which extend [InstrumentedJob](../app/jobs/instrumented_job.rb) will be run on a separate Resque worker. Additionally, any invocations of `Resque.enqueue` will also be run on a separate Resque worker.

### Sentry ([Pricing](https://sentry.io/pricing/))
[Sentry](https://sentry.io/) is a service for error tracking and reporting. The [config/initializers/sentry.rb](../config/initializers/sentry.rb) file contains the configuration for Sentry. Errors can be explicitly reported using the React `log_error` method in [logUtil.ts](../app/assets/src/components/utils/logUtil.ts), and uncaught exceptions are automatically reported.

### Segment Analytics & Appcues ([Segment Pricing](https://segment.com/pricing/), [Appcues Pricing](https://www.appcues.com/pricing))
[Segment Analytics](https://github.com/segmentio/analytics-ruby) is used in conjunction with [Appcues](https://www.appcues.com/) as a middleware tool for analytics. [app/assets/src/api/analytics.ts](../app/assets/src/api/analytics.ts) contains the code for establishing what data is tracked in the frontend/React portion of the app, and other React components can leverage the methods defined in `analytics.ts` to track specific user actions. [app/lib/metric_util.rb](../app/lib/metric_util.rb) establishes the configuration for Segment integration with the backend/Ruby portion of the app. 

### Plausible Analytics ([Pricing](https://plausible.io/#pricing))
[Plausible Analytics](https://github.com/plausible/analytics) is used for wide-scale front-end user tracking/reporting, such as page-view counts, user journeys, dropouts, and more.

### Airtable ([Pricing](https://airtable.com/pricing))
[Airtable](https://www.airtable.com/) is used for maintaining a list of registered CZID users. Data is sent via calls to [MetricUtil.post_to_airtable](../app/lib/metric_util.rb).

### Illumina BaseSpace (_Unknown if API usage incurs costs_)
[BaseSpace](https://basespace.illumina.com/) is a genetic data storage and analysis platform. User may upload samples from BaseSpace to CZID.

### OneTrust (Free)
[OneTrust](https://www.onetrust.com/) is used for handling user consent to cookies and other third-party tracking (e.g. analytics tracking).

### LocationIQ ([Pricing](https://locationiq.com/pricing))
[LocationIQ](https://locationiq.com/) is used for geosearching locations (e.g. searching samples by country, state, and/or city).

### Maptiler ([Pricing](https://www.maptiler.com/cloud/pricing/))
[Maptiler](https://www.maptiler.com/) is used for rendering maps in the UI.

## Environment Variables
`SAMPLES_BUCKET_NAME`: The name of the AWS S3 bucket where user sample data is stored  (e.g. "idseq-samples-prod-us-west-2")  
`SAMPLES_BUCKET_NAME_V1`: The name of the AWS S3 bucket where bulk downloads are stored (e.g. "czi-infectious-disease-prod-samples")  
`S3_WORKFLOWS_BUCKET`: The name of the AWS S3 bucket where Workflow Description Language (WDL) files are stored, used for executing pipelines/workflows (e.g. ...)  
`S3_AEGEA_ECS_EXECUTE_BUCKET`: The name of the AWS S3 bucket used by aegea when running ECS/fargate tasks (e.g. "aegea-ecs-execute-prod")  
`ES_ADDRESS`: The URL of the ElasticSearch endpoint used by the ElasticSearch client, set [here](../config/initializers/elasticsearch.rb#L6) (e.g. "http://opensearch:9200")  
`AIRTABLE_ACCESS_TOKEN`: The HTTP auth bearer token used to authenticate HTTP requests to the Airtable API.  
`AIRTABLE_BASE_ID`: The Airtable Base ID used in API requests. Details on finding ID [can be found here](https://support.airtable.com/docs/finding-airtable-ids#finding-base-table-and-view-ids-from-urls).  
`AUTH_TOKEN_SECRET`: **Appears to be unused.** _Recommend removing references to this._  
`BASESPACE_CLIENT_ID`: The BaseSpace client ID used to authenticate API requests.  
`BASESPACE_CLIENT_SECRET`: The BaseSpace client secret used to authenticate API requests.  
`BASESPACE_OAUTH_REDIRECT_URI`: The BaseSpace OAuth redirect URI used to authenticate API requests.  
`CLI_UPLOAD_ROLE_ARN`: The ARN of the AWS IAM role which is assumed in order to upload samples to S3.  
`GIT_RELEASE_SHA`: The SHA of the current git release, used to identify the release in Sentry for analytics purposes. Set [here](../app/views/layouts/_sentry_monitoring.html.erb#L6) and ingested [here](../app/assets/src/index.tsx#L25).  
`GRAPHQL_FEDERATION_SERVICE_URL`: The URL of the GraphQL federation service to which to establish the GraphQL client. See [czid_graphql_federation.rb](../config/initializers/czid_graphql_federation.rb).  
`ID_SEQ_ENVS_THAT_CAN_SCALE`: **Appears to be unused.** _Recommend removing references to this._  
`LOCATION_IQ_API_KEY`: API key used to interact with [LocationIQ](https://locationiq.com/) for geographic data/search. Config applied [here](../app/models/location.rb#L55).  
`MAPTILER_API_KEY`: API key used to interact with [MapTiler](https://www.maptiler.com/) for rendering maps.  
`PLAUSIBLE_ID`: The data-domain value set when loading the plausible.io analytics script [here](../app/views/layouts/_plausible_analytics.html.erb). (e.g. "czid.org")  
`RACK_ENV`: Failsafe/Backup value for `RAILS_ENV`. Not currently in use in this application.  
`RAILS_ENV`: The environment in which the application is running, typically used to set environment-specific contexts. (e.g. "development", "staging", "production").  
`SEGMENT_JS_ID`: The frontend/JavaScript writekey value set when loading the segment.io analytics script [here](../app/views/layouts/_segment_analytics.html.erb).  
`SEGMENT_RUBY_ID`: The backend/Ruby writekey value set when loading the segment.io analytics script [here](../app/lib/metric_util.rb#10).  
`SENTRY_DSN_BACKEND`: The data source name for integrating with Sentry for backend error tracking, used [here](../config/initializers/sentry.rb#L11).  
`SENTRY_DSN_FRONTEND`: The data source name for integrating with Sentry for frontend error tracking, set [here](../app/views/layouts/_sentry_monitoring.html.erb#L4) and ingested [here](../app/assets/src/index.tsx#L23).  
`SERVER_DOMAIN`: The Rails web app domain, used to set callback URLs for ECS bulk downloads so that they can send status updates back to the web app. (e.g. "czid.org")  
`SMTP_PASSWORD`: The password for the SMTP user, set [here](../config/application.rb#L38). Configures Rails ActionMailer to send emails via SMTP using Amazon SES.  
`SMTP_USER`: The username for the SMTP user, set [here](../config/application.rb#L40). Configures Rails ActionMailer to send emails via SMTP using Amazon SES.  
`SYSTEM_ADMIN_USER_ID`: Admin user ID for interacting with the GraphQL federation service, mainly for identifying soft-deleted data and deleting old bulk downloads.  
`SYSTEM_ADMIN_PROJECT_ID`: **Appears to be unused.** _Recommend removing references to this._  
`HEATMAP_ES_ADDRESS`: The URL of the ElasticSearch endpoint used for generating heatmap data, set [here](../app/helpers/elasticsearch_query_helper.rb#L8).  
`INDEXING_LAMBDA_MODE`: Specifies whether local endpoints are used in lieu of AWS Lambda functions for initiating taxon indexing requests. Used [here](../app/helpers/elasticsearch_query_helper.rb#L774).  
`LOCAL_TAXON_INDEXING_URL`: If the `INDEXING_LAMBDA_MODE` env var is set to `local`, this is the URL of the local endpoint used to initiate taxon indexing requests. Used [here](../app/helpers/elasticsearch_query_helper.rb#L776).  
`LOCAL_EVICTION_URL`: If the `INDEXING_LAMBDA_MODE` env var is set to `local`, this is the URL of the local endpoint used to initiate taxon eviction requests. Used [here](../app/helpers/elasticsearch_query_helper.rb#L777).
`ALLOW_DIRECT_USER_LOGIN`: Only applicable for the development environment. If set to `true`, allows users to login directly to the web app via the `/direct_user_login?user_id=<ID>` endpoint without going through the Auth0 authentication flow.