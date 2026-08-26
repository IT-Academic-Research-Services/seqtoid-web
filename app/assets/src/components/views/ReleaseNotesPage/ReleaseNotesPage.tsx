import React, { useEffect, useMemo, useState } from "react";
import { get } from "~/api/core";
import { Footer } from "~/components/common/Footer";
import { LandingHeader } from "~/components/common/LandingHeader";
import cs from "./release_notes_page.scss";

// Each COMPONENT is a repo. public = shown on the production (end-user) feed.
// Kept in sync with RELEASE_NOTE_COMPONENTS in support_controller.rb.
const COMPONENTS: Record<
  string,
  { label: string; repo: string; public: boolean }
> = {
  web: { label: "Web app", repo: "seqtoid-web", public: true },
  workflows: { label: "Pipelines", repo: "seqtoid-workflows", public: true },
  swipe: { label: "Alignment", repo: "swipe", public: true },
  cli: { label: "CLI", repo: "seqtoid-cli", public: true },
  reference: {
    label: "Reference data",
    repo: "idseq-index-generation",
    public: true,
  },
  "workflow-infra": {
    label: "Pipeline infra",
    repo: "cypherid-workflow-infra",
    public: false,
  },
  ssot: { label: "Platform infra", repo: "seqtoid-ssot-infra", public: false },
};

const GH = "https://github.com/IT-Academic-Research-Services/";
const SEEN_KEY = "seqtoid_releases_seen";

// Repo filter chips (mirrors the prototype). "all" plus the four product repos.
const REPO_CHIPS: { comp: string; label: string }[] = [
  { comp: "all", label: "All repos" },
  { comp: "web", label: "Web app" },
  { comp: "workflows", label: "Pipelines" },
  { comp: "swipe", label: "Alignment" },
  { comp: "cli", label: "CLI" },
];

interface Change {
  type: string;
  title: string;
  pr?: number | null;
  url?: string | null;
}

interface Release {
  env?: string;
  version: string;
  day: string;
  n: number;
  time?: string;
  component: string;
  source_repo?: string;
  sha?: string;
  reason?: string;
  changes: Change[];
}

interface ReleaseNotesPageProps {
  dataUrl: string;
  // True on the public production feed: the audience toggle is hidden and the
  // view defaults to the public feed. The server has already filtered/stripped
  // the ledger, so this is presentation-only.
  public: boolean;
}

// ledger key: one entry per DEPLOY (one repo). day (YYYYMMDD) + zero-padded n, so
// keys sort chronologically as strings.
const keyOf = (r: Release): string =>
  r.day.replace(/-/g, "") + String(r.n).padStart(3, "0");

const fmtDay = (d: string): string =>
  new Date(d + "T00:00:00Z").toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const tagClass = (type: string): string => {
  const map: Record<string, string> = {
    added: cs.tAdded,
    fixed: cs.tFixed,
    changed: cs.tChanged,
    security: cs.tSecurity,
    removed: cs.tRemoved,
  };
  return map[type] || "";
};

const ReleaseNotesPage = ({
  dataUrl,
  public: isPublic,
}: ReleaseNotesPageProps) => {
  const [releases, setReleases] = useState<Release[]>([]);
  const [aud, setAud] = useState<"internal" | "public">(
    isPublic ? "public" : "internal",
  );
  const [compFilter, setCompFilter] = useState<string>("all");
  const [seen, setSeen] = useState<string>("");
  // day string -> explicit expanded/collapsed override. Absent = default
  // (newest day expanded, the rest collapsed).
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSeen(
      (typeof window !== "undefined" &&
        window.localStorage.getItem(SEEN_KEY)) ||
        "",
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    get(dataUrl)
      .then((data: $TSFixMe) => {
        if (!cancelled) setReleases(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        // Never surface a raw error here: an unreachable/empty ledger renders
        // the empty state, matching the server serving [] on failure.
        if (!cancelled) setReleases([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  const shown = (r: Release): boolean => {
    if (aud === "public" && !(COMPONENTS[r.component] || {}).public)
      return false;
    if (compFilter !== "all" && r.component !== compFilter) return false;
    return true;
  };

  // Public feed hides PR links -- they point at (mostly private) internal repos
  // and 404 for the public.
  const linkPRs = aud !== "public";

  // Group the filtered ledger by day, newest day first.
  const days = useMemo(() => {
    const byDay: Record<string, Release[]> = {};
    const order: string[] = [];
    releases.filter(shown).forEach(r => {
      if (!byDay[r.day]) {
        byDay[r.day] = [];
        order.push(r.day);
      }
      byDay[r.day].push(r);
    });
    order.sort().reverse();
    return order.map(day => ({
      day,
      rels: byDay[day].slice().sort((a, b) => b.n - a.n),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releases, aud, compFilter]);

  const newReleaseCount = useMemo(
    () => releases.filter(r => shown(r) && keyOf(r) > seen).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [releases, aud, compFilter, seen],
  );
  const newDayCount = useMemo(
    () => days.filter(d => d.rels.some(r => keyOf(r) > seen)).length,
    [days, seen],
  );

  const markAllRead = () => {
    if (releases.length === 0) return;
    const maxKey = releases.reduce(
      (max, r) => (keyOf(r) > max ? keyOf(r) : max),
      "",
    );
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEEN_KEY, maxKey);
    }
    setSeen(maxKey);
  };

  const isDayExpanded = (day: string, index: number): boolean =>
    day in expandedDays ? expandedDays[day] : index === 0;

  const toggleDay = (day: string, index: number) => {
    const current = isDayExpanded(day, index);
    setExpandedDays(prev => ({ ...prev, [day]: !current }));
  };

  const audNote =
    aud === "public"
      ? "Public preview -- production, end-user view: the infra repos drop out entirely (Platform infra, Pipeline infra). Only product repos remain."
      : "Internal view -- every repo incl. infrastructure. Only signed-in testers & team see this (dev/staging).";
  const ctxLabel = aud === "public" ? "Production -- public" : "Env-Staging";

  const renderRelease = (rel: Release) => {
    const meta = COMPONENTS[rel.component] || {
      label: rel.component,
      repo: "",
    };
    const isnew = keyOf(rel) > seen;
    return (
      <div
        key={rel.version}
        className={isnew ? `${cs.rel} ${cs.isnew}` : cs.rel}
      >
        <div className={cs.relhead}>
          <span className={cs.comp}>{meta.label}</span>
          <span className={cs.ver}>{rel.version}</span>
          <span className={cs.reltime}>{rel.time || ""}</span>
        </div>
        {aud === "internal" && (rel.sha || rel.reason) && (
          <div className={cs.reason}>
            {rel.sha && (
              <>
                <span className={cs.k}>{meta.repo}</span>
                {rel.sha}
                {"  "}
              </>
            )}
            {rel.reason && (
              <>
                <span className={cs.k}>Reason</span>
                {rel.reason}
              </>
            )}
          </div>
        )}
        <div className={cs.changes}>
          {rel.changes.map((c, i) => (
            <div className={cs.entry} key={i}>
              <span className={`${cs.etag} ${tagClass(c.type)}`}>{c.type}</span>
              <span className={cs.etitle}>{c.title}</span>
              <span className={cs.epr}>
                {linkPRs && c.pr ? (
                  <a
                    href={`${GH}${meta.repo}/pull/${c.pr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    #{c.pr}
                  </a>
                ) : (
                  ""
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <LandingHeader legalNav />
      <div className={cs.releaseNotesPage}>
        <div className={cs.wrap}>
          <div className={cs.eyebrow}>
            <div className={cs.brand}>
              <span className={cs.dot} />
              <span className={cs.mono}>SeqToID &middot; Release Notes</span>
            </div>
            <span className={cs.mono}>{ctxLabel}</span>
          </div>

          <div className={cs.hero}>
            <span className={cs.mono}>
              One entry per repo that ships &mdash; grouped by day
            </span>
            <h1>Release notes</h1>
            <div className={cs.sub}>every deploy stands on its own</div>
            <p className={cs.lede}>
              Each <b>deployment entry</b> is one repo shipping to this
              environment &mdash; the web app, the aligner, the pipelines, the
              CLI, the infra &mdash; with its changes listed under it. A repo&apos;s
              version <b>YYYY.MM.DD.n</b> is tied to the day; <b>n</b> counts
              every deploy that day across all repos.
            </p>
            {newReleaseCount > 0 && (
              <div className={`${cs.newbar} ${cs.show}`}>
                <div className={cs.txt}>
                  <b>
                    {newReleaseCount}
                    {newReleaseCount > 1 ? " new releases" : " new release"}
                    {newDayCount > 1 ? ` across ${newDayCount} days` : ""}
                  </b>{" "}
                  since you were last here.
                </div>
                <button className={cs.act} onClick={markAllRead}>
                  Mark all as read
                </button>
              </div>
            )}
          </div>

          <div className={cs.controls}>
            {!isPublic && (
              <div
                className={cs.seg}
                role="group"
                aria-label="Audience"
              >
                <button
                  aria-pressed={aud === "internal"}
                  onClick={() => setAud("internal")}
                >
                  Internal
                </button>
                <button
                  aria-pressed={aud === "public"}
                  onClick={() => setAud("public")}
                >
                  Public preview
                </button>
              </div>
            )}
            <span className={cs.grow} />
            {REPO_CHIPS.map(chip => (
              <button
                key={chip.comp}
                className={cs.chip}
                aria-pressed={compFilter === chip.comp}
                onClick={() => setCompFilter(chip.comp)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {!isPublic && <div className={cs.envnote}>{audNote}</div>}

          <div className={cs.days}>
            {days.length === 0 && (
              <div className={cs.empty}>
                No release notes to show yet. Check back after the next deploy.
              </div>
            )}
            {days.map(({ day, rels }, di) => {
              const expanded = isDayExpanded(day, di);
              const changeCount = rels.reduce(
                (s, r) => s + r.changes.length,
                0,
              );
              const comps = Array.from(
                new Set(
                  rels.map(r => (COMPONENTS[r.component] || {}).label || r.component),
                ),
              );
              const dayNew = rels.some(r => keyOf(r) > seen);
              return (
                <div
                  key={day}
                  className={expanded ? cs.day : `${cs.day} ${cs.collapsed}`}
                >
                  <button
                    className={cs.daysum}
                    onClick={() => toggleDay(day, di)}
                  >
                    <span className={cs.caret}>&rsaquo;</span>
                    <span className={cs.dayinfo}>
                      <span className={cs.dday}>{fmtDay(day)}</span>
                      <span className={cs.dmeta}>
                        {rels.length}
                        {rels.length > 1 ? " deploys" : " deploy"} &middot;{" "}
                        {comps.join(", ")} &middot; {changeCount} change
                        {changeCount > 1 ? "s" : ""}
                      </span>
                    </span>
                    <span className={cs.grow} />
                    {dayNew && <span className={cs.newtag}>New</span>}
                  </button>
                  {expanded && (
                    <div className={cs.daybody}>{rels.map(renderRelease)}</div>
                  )}
                </div>
              );
            })}
          </div>

          <footer className={cs.pagefooter}>
            <span className={cs.mono}>SeqToID &middot; Release Notes</span>
            <span className={cs.mono}>{ctxLabel}</span>
          </footer>
        </div>
      </div>
      <Footer />
    </>
  );
};

export default ReleaseNotesPage;
export { ReleaseNotesPage };
