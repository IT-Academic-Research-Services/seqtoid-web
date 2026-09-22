#!/usr/bin/env python3
"""Regression tests for the release-notes collector (script/changelog/collect.py).

Covers SMP-1875: a deploy whose new SHA reached main via a promote/rollup MERGE
(integration->main, or a promote(dev): sha-... merge) used to record "0 changes",
because the feature commits it carried arrive WITHOUT a squash "title (#NNN)"
subject and the old collector only parsed that subject. prs_between now resolves
each commit in the range to its PR via the commit->PR association API, so those
deploys record their real changes; when the token lacks pull_requests:read the
association calls return empty and it falls back to the old subject parse.

The GitHub calls are shelled out through collect.sh, which these tests patch with
canned fixtures -- no network, no gh, no aws.
"""

import unittest
from unittest.mock import patch

from script.changelog import collect


def _make_sh(compare_shas=None, compare_subjects=None, pulls=None):
    """Build a fake collect.sh from fixtures.

    compare_shas:     list of commit SHAs the compare API reports for the range
    compare_subjects: list of first-line commit subjects for the same range
    pulls:            {sha: [(number, title), ...]} for /commits/{sha}/pulls;
                      a sha absent from the map (or mapped to []) resolves to
                      nothing, emulating a token without pull_requests:read.
    """
    compare_shas = compare_shas or []
    compare_subjects = compare_subjects or []
    pulls = pulls or {}

    def fake_sh(cmd, check=False):
        url = cmd[2]
        jq = cmd[4] if len(cmd) > 4 else ""
        if "/compare/" in url:
            if ".sha" in jq:
                return "\n".join(compare_shas)
            if "commit.message" in jq:
                return "\n".join(compare_subjects)
            raise AssertionError("unexpected compare jq: " + jq)
        if "/commits/" in url and url.endswith("/pulls"):
            sha = url.split("/commits/", 1)[1].rsplit("/pulls", 1)[0]
            rows = pulls.get(sha, [])
            return "\n".join("{}\t{}".format(n, t) for n, t in rows)
        raise AssertionError("unexpected gh api url: " + url)

    return fake_sh


class TestPrsBetweenPromoteMerge(unittest.TestCase):
    """The core SMP-1875 fix: promote/rollup merges resolve to their real PRs."""

    def test_promote_merge_resolves_underlying_pr_not_zero(self):
        # PR 469 reached main via an integration->main promote: its two feature
        # commits carry NO "(#NNN)" subject, and the range also contains the
        # promote merge commit itself. The association API maps the feature
        # commits to PR 469; the promote merge maps to a noise PR that is dropped.
        sh = _make_sh(
            compare_shas=["feat_a", "feat_b", "promote_m"],
            pulls={
                "feat_a": [(469, "Add React project page")],
                "feat_b": [(469, "Add React project page")],
                "promote_m": [(540, "promote(dev): bring integration up to main")],
            },
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "Web application")
        self.assertEqual([c["pr"] for c in changes], [469])
        self.assertEqual(changes[0]["title"], "Add React project page")
        self.assertEqual(changes[0]["type"], "added")
        self.assertEqual(changes[0]["piece"], "Web application")
        self.assertEqual(changes[0]["url"], "https://github.com/R/pull/469")

    def test_pr_spanning_many_commits_is_deduped(self):
        sh = _make_sh(
            compare_shas=["c1", "c2", "c3"],
            pulls={
                "c1": [(470, "Fix upload stall")],
                "c2": [(470, "Fix upload stall")],
                "c3": [(470, "Fix upload stall")],
            },
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "")
        self.assertEqual([c["pr"] for c in changes], [470])

    def test_squash_merge_still_resolves_via_association(self):
        # A normal squash-merged PR (single commit) still resolves through the
        # association path -- the fix does not regress the common case.
        sh = _make_sh(
            compare_shas=["squash1"],
            pulls={"squash1": [(471, "Add selectable pipeline version")]},
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "")
        self.assertEqual([c["pr"] for c in changes], [471])
        self.assertEqual(changes[0]["type"], "added")

    def test_multiple_prs_sorted_by_number(self):
        sh = _make_sh(
            compare_shas=["a", "b", "c"],
            pulls={
                "a": [(482, "Fix taxon lineage regression")],
                "b": [(475, "Add long-read support")],
                "c": [(475, "Add long-read support")],
            },
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "")
        self.assertEqual([c["pr"] for c in changes], [475, 482])

    def test_empty_prev_sha_returns_no_changes(self):
        # First-ever deploy for a component: no baseline, nothing to diff.
        with patch.object(collect, "sh", _make_sh()):
            self.assertEqual(collect.prs_between("R", "", "NEW", ""), [])

    def test_only_promote_noise_yields_zero_changes(self):
        # A range that genuinely carries only plumbing (a promote of a promote)
        # legitimately records 0 changes -- noise is filtered, not counted.
        sh = _make_sh(
            compare_shas=["m1"],
            pulls={"m1": [(541, "promote(staging): sha-deadbee")]},
        )
        with patch.object(collect, "sh", sh):
            self.assertEqual(collect.prs_between("R", "PREV", "NEW", ""), [])


class TestPrsBetweenFallback(unittest.TestCase):
    """When the token lacks pull_requests:read the association calls return empty
    and prs_between falls back to parsing the squash "(#NNN)" subject -- never
    worse than the pre-fix behavior."""

    def test_fallback_parses_squash_subject_when_association_empty(self):
        sh = _make_sh(
            compare_shas=["sq1", "promote_m"],
            compare_subjects=["Fix upload stall (#470)", "promote(dev): sha-mmm"],
            pulls={},  # no association access
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "")
        self.assertEqual([c["pr"] for c in changes], [470])
        self.assertEqual(changes[0]["title"], "Fix upload stall")

    def test_fallback_misses_bare_promote_commits(self):
        # This is exactly the pre-fix failure mode the association path fixes:
        # with no association access AND no "(#NNN)" subjects (a promote that
        # merge-committed feature work), the fallback finds nothing. Documents
        # why pull_requests:read on the record token is a hard dependency.
        sh = _make_sh(
            compare_shas=["feat_a", "feat_b"],
            compare_subjects=["Add React project page", "Wire up project routes"],
            pulls={},
        )
        with patch.object(collect, "sh", sh):
            self.assertEqual(collect.prs_between("R", "PREV", "NEW", ""), [])

    def test_fallback_deduplicates_and_filters_noise(self):
        sh = _make_sh(
            compare_shas=["x", "y", "z"],
            compare_subjects=[
                "Add selectable pipeline version (#471)",
                "Add selectable pipeline version (#471)",
                "Merge branch 'integration' into main (#999)",
            ],
            pulls={},
        )
        with patch.object(collect, "sh", sh):
            changes = collect.prs_between("R", "PREV", "NEW", "")
        self.assertEqual([c["pr"] for c in changes], [471])


class TestNoisePrClassifier(unittest.TestCase):
    def test_promote_and_rollup_titles_are_noise(self):
        for title in [
            "promote(dev): sha-abc123",
            "promote(staging): bring integration up to main",
            "Merge pull request #500 from foo/bar",
            "sync: main -> integration",
            "gitops: advance dev to sha-deadbee",
            "roll integration into main",
            "bring integration up to main",
            "integration -> main promote",
        ]:
            self.assertTrue(collect._noise_pr(title), "should be noise: " + title)

    def test_real_feature_titles_are_not_noise(self):
        for title in [
            "Add React project page",
            "Fix upload stall concurrency",
            "Introduce selectable pipeline version",
            "Harden bulk-download retries",
        ]:
            self.assertFalse(collect._noise_pr(title), "should NOT be noise: " + title)


class TestChangeTypeAndClassify(unittest.TestCase):
    def test_change_type(self):
        self.assertEqual(collect.change_type("Fix upload stall"), "fixed")
        self.assertEqual(collect.change_type("Add long-read support"), "added")
        self.assertEqual(collect.change_type("feat: selectable version"), "added")
        self.assertEqual(collect.change_type("Remove deprecated endpoint"), "removed")
        self.assertEqual(collect.change_type("Harden download restrictions"), "security")
        self.assertEqual(collect.change_type("Tweak layout spacing"), "changed")

    def test_default_piece_overrides_classifier(self):
        self.assertEqual(collect.classify("anything at all", "Alignment engine"), "Alignment engine")

    def test_classifier_routes_by_keyword(self):
        self.assertEqual(collect.classify("Fix taxon lineage refresh", ""), "Reference data")
        self.assertEqual(collect.classify("Add nanopore long-read workflow", ""), "Analysis pipelines")
        self.assertEqual(collect.classify("Update auth0 login screen", ""), "Accounts & access")
        self.assertEqual(collect.classify("Bump swipe alignment image", ""), "Alignment engine")
        self.assertEqual(collect.classify("Rework terraform eks module", ""), "Platform & infrastructure")
        self.assertEqual(collect.classify("Redesign the samples table UI", ""), "Web application")


if __name__ == "__main__":
    unittest.main()
