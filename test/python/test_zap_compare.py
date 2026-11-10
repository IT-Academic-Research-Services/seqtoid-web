#!/usr/bin/env python3
"""Unit tests for the DAST baseline comparison (scripts/dast/zap_compare.py).

No network, no docker: the ZAP JSON reports are small canned dicts shaped like
zap-baseline.py -J output (ZAP 2.17).
"""

import contextlib
import io
import json
import os
import tempfile
import unittest

from scripts.dast import zap_compare as zc


def alert(ref, riskcode, uris, name="Some Alert"):
    pluginid = ref.split("-")[0]
    return {"pluginid": pluginid, "alertRef": ref, "alert": name, "name": name,
            "riskcode": str(riskcode), "riskdesc": "x",
            "instances": [{"uri": u, "method": "GET"} for u in uris]}


def report(*alerts):
    return {"@programName": "ZAP", "site": [{"@name": "https://dev.seqtoid.org",
                                             "alerts": list(alerts)}]}


def baseline(*entries):
    return {"findings": [dict(e, reason="accepted at baseline 2026-11-10; triage")
                         for e in entries]}


class NormalizePath(unittest.TestCase):
    def test_root_forms(self):
        self.assertEqual(zc.normalize_path("https://dev.seqtoid.org"), "/")
        self.assertEqual(zc.normalize_path("https://dev.seqtoid.org/"), "/")

    def test_strips_query_fragment_and_host(self):
        self.assertEqual(zc.normalize_path("https://pr-12.dev.seqtoid.org/login?x=1&y=2#top"),
                         "/login")

    def test_collapses_numeric_ids_and_uuids(self):
        self.assertEqual(zc.normalize_path("https://h/samples/12345/report/9"),
                         "/samples/{id}/report/{id}")
        self.assertEqual(
            zc.normalize_path("https://h/bulk/0f8fad5b-d9cb-469f-a165-70867728950e"),
            "/bulk/{uuid}")

    def test_collapses_asset_fingerprints(self):
        self.assertEqual(
            zc.normalize_path("https://h/assets/vendors.debug-ab490343cc75ff0ce7415055455021f6e29.js"),
            "/assets/vendors.debug-{hash}.js")
        self.assertEqual(zc.normalize_path("https://h/assets/app.4e5f6a7b8c.css"),
                         "/assets/app.{hash}.css")
        self.assertEqual(zc.normalize_path("https://h/assets/index-BxYz12Ab.js"),
                         "/assets/index-{hash}.js")
        # Two builds of the same asset produce the same key.
        a = zc.normalize_path("https://h/assets/application-3a6e234335e6d35f.js")
        b = zc.normalize_path("https://h/assets/application-f5572557ac22ae6c.js")
        self.assertEqual(a, b)

    def test_leaves_plain_names_alone(self):
        self.assertEqual(zc.normalize_path("https://h/robots.txt"), "/robots.txt")
        self.assertEqual(zc.normalize_path("https://h/auth0/login"), "/auth0/login")


class Compare(unittest.TestCase):
    def _cmp(self, rep, base, fail_on="Medium", ignored=frozenset()):
        return zc.compare(zc.extract_findings(rep, ignored), zc.load_baseline(base), fail_on)

    def test_new_medium_fails(self):
        res = self._cmp(report(alert("10038-1", 2, ["https://dev.seqtoid.org/"])), baseline())
        self.assertEqual(res["result"], "fail")
        self.assertEqual(len(res["new_blocking"]), 1)

    def test_new_low_passes_under_default(self):
        res = self._cmp(report(alert("10035-1", 1, ["https://dev.seqtoid.org/"])), baseline())
        self.assertEqual(res["result"], "pass")
        self.assertEqual(len(res["new"]), 1)
        self.assertEqual(res["new_blocking"], [])

    def test_new_low_fails_when_fail_on_low(self):
        res = self._cmp(report(alert("10035-1", 1, ["https://dev.seqtoid.org/"])), baseline(),
                        fail_on="low")
        self.assertEqual(res["result"], "fail")

    def test_accepted_finding_passes(self):
        rep = report(alert("10038-1", 2, ["https://dev.seqtoid.org", "https://dev.seqtoid.org/?a=1"]))
        base = baseline({"pluginid": "10038", "alertRef": "10038-1", "risk": "Medium", "path": "/"})
        res = self._cmp(rep, base)
        self.assertEqual(res["result"], "pass")
        self.assertEqual(len(res["accepted"]), 1)
        self.assertEqual(res["new"], [])

    def test_accepted_finding_on_reshuffled_asset_passes(self):
        base = baseline({"alertRef": "90003", "risk": "Medium",
                         "path": "/assets/application-{hash}.js"})
        rep = report(alert("90003", 2, ["https://h/assets/application-0123456789abcdef.js"]))
        self.assertEqual(self._cmp(rep, base)["result"], "pass")

    def test_risk_escalation_is_new(self):
        base = baseline({"alertRef": "10011", "risk": "Low", "path": "/"})
        res = self._cmp(report(alert("10011", 2, ["https://h/"])), base)
        self.assertEqual(res["result"], "fail")
        self.assertEqual(len(res["fixed"]), 1)

    def test_fixed_reported(self):
        base = baseline({"alertRef": "10035-1", "risk": "Low", "path": "/"})
        res = self._cmp(report(), base)
        self.assertEqual(res["result"], "pass")
        self.assertEqual([f["alertRef"] for f in res["fixed"]], ["10035-1"])

    def test_glob_path_in_baseline(self):
        base = baseline({"alertRef": "10038-1", "risk": "Medium", "path": "/*"})
        rep = report(alert("10038-1", 2, ["https://h/", "https://h/landing/about"]))
        self.assertEqual(self._cmp(rep, base)["result"], "pass")

    def test_distinct_alert_refs_not_conflated(self):
        base = baseline({"alertRef": "90004-1", "risk": "Low", "path": "/"})
        res = self._cmp(report(alert("90004-2", 1, ["https://h/"])), base)
        self.assertEqual(len(res["new"]), 1)

    def test_ignored_rule_dropped(self):
        rep = report(alert("10116", 2, ["https://h/"]))
        self.assertEqual(self._cmp(rep, baseline(), ignored={"10116"})["result"], "pass")

    def test_empty_report_passes(self):
        res = self._cmp(report(), baseline())
        self.assertEqual(res["result"], "pass")
        res = self._cmp({"site": []}, baseline())
        self.assertEqual(res["result"], "pass")


class Malformed(unittest.TestCase):
    def test_not_a_report(self):
        with self.assertRaises(zc.InputError):
            zc.extract_findings({"foo": 1})
        with self.assertRaises(zc.InputError):
            zc.extract_findings([])

    def test_bad_risk(self):
        with self.assertRaises(zc.InputError):
            zc.extract_findings(report(alert("1", 9, ["https://h/"])))

    def test_bad_baseline(self):
        with self.assertRaises(zc.InputError):
            zc.load_baseline({"findings": [{"risk": "Low"}]})
        with self.assertRaises(zc.InputError):
            zc.load_baseline([])


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def _write(self, name, content):
        path = os.path.join(self.tmp.name, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content if isinstance(content, str) else json.dumps(content))
        return path

    def _main(self, rep, base, rules=None, extra=()):
        out = self._write("out", "")
        md = self._write("md", "")
        argv = ["--report", rep, "--baseline", base, "--github-output", out,
                "--summary-md", md] + list(extra)
        if rules:
            argv += ["--rules", rules]

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = zc.main(argv)
        with open(out, encoding="utf-8") as fh:
            outputs = dict(ln.split("=", 1) for ln in fh.read().splitlines())
        return code, outputs

    def test_pass_and_outputs(self):
        code, outs = self._main(self._write("r.json", report()), self._write("b.json", baseline()))
        self.assertEqual(code, 0)
        self.assertEqual(outs["result"], "pass")
        self.assertIn("ZAP baseline PASS", outs["summary"])

    def test_fail_exit_1(self):
        rep = self._write("r.json", report(alert("10038-1", 2, ["https://h/"])))
        code, outs = self._main(rep, self._write("b.json", baseline()))
        self.assertEqual((code, outs["result"]), (1, "fail"))

    def test_malformed_json_fails_closed(self):
        code, outs = self._main(self._write("r.json", "{not json"), self._write("b.json", baseline()))
        self.assertEqual((code, outs["result"]), (2, "fail"))
        self.assertIn("bad input", outs["summary"])

    def test_missing_report_fails_closed(self):
        code, outs = self._main(os.path.join(self.tmp.name, "nope.json"),
                                self._write("b.json", baseline()))
        self.assertEqual((code, outs["result"]), (2, "fail"))

    def test_rules_file_ignore(self):
        rules = self._write("rules.tsv", "# comment\n10116\tIGNORE\t(ZAP is Out of Date)\n")
        rep = self._write("r.json", report(alert("10116", 2, ["https://h/"])))
        code, _ = self._main(rep, self._write("b.json", baseline()), rules=rules)
        self.assertEqual(code, 0)

    def test_repo_baseline_and_rules_parse(self):
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(root, ".zap", "baseline.json"), encoding="utf-8") as fh:
            entries = zc.load_baseline(json.load(fh))
        self.assertTrue(entries)
        for e in entries:
            self.assertTrue(e["reason"])
        zc.load_ignored(os.path.join(root, ".zap", "rules.tsv"))


if __name__ == "__main__":
    unittest.main()
