import { ThemeProvider as EmotionThemeProvider } from "@emotion/react";
import { StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import * as Sentry from "@sentry/react";
import "font-awesome/scss/font-awesome.scss";
import React, { ComponentClass, FunctionComponent, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "semantic-ui-css/semantic.min.css";
import "url-search-params-polyfill";
import ErrorFallback from "~/components/common/ErrorBoundary/ErrorFallback";
import SupportPortal from "~/components/common/SupportPortal/SupportPortal";
import { UserContext } from "~/components/common/UserContext";
import { ucsfTheme } from "~/theme/ucsfTheme";
import { initialGlobalContextState } from "./globalContext/initialState";
import { GlobalContext, globalContextReducer } from "./globalContext/reducer";
import UserContextType from "./interface/allowedFeatures";
import "./loader.scss";
import RelayEnvironment from "./relay/RelayEnvironment";
import "./styles/appcues.scss";
import "./styles/core.scss";

// CZID-391: the Relay GraphQL fetch client (generateFetchFn) used to log every
// request/response — and non-fatal field-level GraphQL errors — to Sentry as
// Info-level events, drowning the dashboard (~74 `generateFetchFn.req=` /
// `generateFetchFn.res=` / `[GQL Error]` Info entries). The source-side logging is
// removed in relay/environment.ts; this beforeSend is a defense-in-depth filter that
// also suppresses any residual Info-level generateFetchFn/GQL noise still emitted by
// older deployed bundles. Only `level: "info"` req/res breadcrumbs are dropped —
// warnings, errors, and captured exceptions pass through untouched so real
// regressions stay visible.
const isGenerateFetchFnInfoNoise = (event: Sentry.Event): boolean => {
  // Sentry v7+ removed the Severity enum; event.level is a SeverityLevel string literal.
  if (event.level !== "info") return false;
  const message = event.message ?? "";
  return (
    message.includes("generateFetchFn") || message.startsWith("[GQL Error]")
  );
};

// Sentry Basic Configuration Options: https://docs.sentry.io/platforms/javascript/guides/react/config/basics/
Sentry.init({
  dsn: window.SENTRY_DSN_FRONTEND,
  environment: window.ENVIRONMENT,
  release: window.GIT_RELEASE_SHA,
  beforeSend: event => {
    if (isGenerateFetchFnInfoNoise(event)) return null;
    if (
      event.level &&
      (event.level === "log" ||
        event.level === "info" ||
        event.level === "debug")
    )
      return null;
    return event;
  },
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error", "assert"] }),
  ],
});

// eslint-disable-next-line @typescript-eslint/no-empty-function
if (!function f() {}.name) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Function.prototype, "name", {
    get: function () {
      const name = (this.toString().match(/^function\s*([^\s(]+)/) || [])[1];
      Object.defineProperty(this, "name", { value: name });
      return name;
    },
  });
}

const context = require.context("./components", true, /\.(js|jsx|ts|tsx)$/);
const foundComponents = {};
const contextKeys = context.keys();
contextKeys.forEach(key => {
  let a = null;
  if (typeof context(key) === "function") {
    a = context(key);
  } else if (typeof context(key) === "object") {
    a = context(key).default;
  }
  // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2339
  if (a && a.name) {
    // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2339
    foundComponents[a.name] = a;
  }
});

// Using a function component provides a way to access useReducer
const ReactComponentWithGlobalContext = ({
  matchedComponent,
  props,
  userContext,
}: {
  matchedComponent: string | FunctionComponent<any> | ComponentClass<any, any>;
  props: any;
  userContext: UserContextType;
}) => {
  const [globalContextState, globalContextDispatch] = useReducer(
    globalContextReducer,
    initialGlobalContextState,
  );
  return (
    // App-root catch-all (#466): any view mounted via react_component that is
    // not already wrapped by its own ErrorBoundary (report/heatmap/downloads)
    // still lands here. Render the shared friendly ErrorFallback instead of the
    // old bare "An error has occured" string, so a thrown render error shows a
    // clean message + retry rather than a blank/technical page. Sentry.ErrorBoundary
    // keeps reporting the exception to Sentry (#382) and exposes resetError for
    // the retry.
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error} onRetry={resetError} />
      )}
    >
      <BrowserRouter>
        <RelayEnvironment>
          <UserContext.Provider value={userContext}>
            <GlobalContext.Provider
              value={{ globalContextState, globalContextDispatch }}
            >
              <StyledEngineProvider injectFirst>
                <EmotionThemeProvider theme={ucsfTheme}>
                  <ThemeProvider theme={ucsfTheme}>
                    {React.createElement(matchedComponent, props)}
                    {/* In-app self-help portal (#440): floating Help/Diagnostics
                        button, rendered on every authenticated page. It reads
                        UserContext and no-ops for signed-out visitors. */}
                    <SupportPortal />
                  </ThemeProvider>
                </EmotionThemeProvider>
              </StyledEngineProvider>
            </GlobalContext.Provider>
          </UserContext.Provider>
        </RelayEnvironment>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  );
};

// Turn off camelcase rule
/* eslint camelcase: 0 */
const react_component = (
  componentName: string,
  props: object,
  target: string,
  userContext,
) => {
  const matchedComponent = foundComponents[componentName];
  if (matchedComponent) {
    // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2345
    const root = createRoot(document.getElementById(target));
    root.render(
      <ReactComponentWithGlobalContext
        matchedComponent={matchedComponent}
        props={props}
        userContext={userContext}
      />,
    );
    if (userContext && userContext.userId) {
      Sentry.setUser({ id: userContext.userId });
    }
  } else {
    // eslint-disable-next-line no-console
    console.error(
      "Couldn't find component for",
      componentName,
      foundComponents,
    );
  }
};

window.react_component = react_component;
