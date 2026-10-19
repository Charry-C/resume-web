"""Permission boundary regressions; all document data lives in a temporary directory."""
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import auth, main


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(main, "DATA", Path(self.tmp.name))
        self.data_patch.start()
        self.env_patch = patch.dict(os.environ, {"ADMIN_PASSWORD": "test-admin-password", "COOKIE_SECURE": "false"})
        self.env_patch.start()
        auth.SESSIONS.clear()
        auth.ATTEMPTS.clear()
        self.admin = TestClient(main.app)
        self.guest = TestClient(main.app)
        self.anonymous = TestClient(main.app)
        self.resume = json.loads(main.FIXTURE.read_text())
        for did in ("alice", "bob"):
            main.save_doc(did, id=did, name=did, resume=self.resume, annotations=[{"note": "Private feedback"}], pages=[f"/data/{did}/page-0.png"])
            (main.doc_dir(did) / "page-0.png").write_bytes(b"private original")
            (main.doc_dir(did) / "transcript.md").write_text(f"private {did}")
        self.assertEqual(self.admin.post("/api/auth/login", json={"password": "test-admin-password"}).status_code, 200)

    def tearDown(self):
        self.data_patch.stop()
        self.env_patch.stop()
        self.tmp.cleanup()
        auth.SESSIONS.clear()
        auth.ATTEMPTS.clear()

    def share(self, did="alice", password="alice-private-pass"):
        r = self.admin.put(f"/api/docs/{did}/access", json={"password": password})
        self.assertEqual(r.status_code, 200, r.text)

    def unlock(self, client=None, **payload):
        return (client or self.guest).post("/api/auth/unlock", json={"password": "alice-private-pass", **payload})

    def test_anonymous_cannot_read_documents_originals_or_settings(self):
        for path in ("/api/docs", "/api/docs/alice", "/api/docs/alice/transcript", "/api/docs/alice/access", "/api/settings", "/data/alice/page-0.png", "/data/alice/doc.json", "/data/alice/access.json", "/data/alice/transcript.md"):
            with self.subTest(path=path):
                r = self.anonymous.get(path)
                self.assertEqual(r.status_code, 403)
                self.assertEqual(r.headers["cache-control"], "no-store")

    def test_admin_can_list_edit_annotate_and_access_settings(self):
        self.assertEqual(len(self.admin.get("/api/docs").json()), 2)
        r = self.admin.put("/api/docs/alice", json={"name": "Reviewed", "annotations": [{"note": "new feedback"}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.admin.get("/api/docs/alice").json()["annotations"][0]["note"], "new feedback")
        self.assertEqual(self.admin.get("/api/settings").status_code, 200)
        self.assertEqual(self.admin.get("/data/alice/page-0.png").status_code, 200)

    def test_guest_unlocks_own_doc_with_password_only(self):
        self.share()
        self.assertEqual(self.unlock().json(), {"doc_id": "alice"})
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 200)
        self.assertEqual(self.guest.get("/api/docs/alice/transcript").text, "private alice")
        self.assertEqual(self.guest.get("/data/alice/page-0.png").content, b"private original")
        self.assertEqual(self.guest.get("/api/auth/session").json()["doc_id"], "alice")

    def test_guest_cannot_read_another_doc_or_list(self):
        self.share(); self.share("bob", "bob-private-pass")
        self.assertEqual(self.unlock(doc_id="alice").status_code, 200)
        for path in ("/api/docs", "/api/docs/bob", "/data/bob/page-0.png", "/api/docs/bob/transcript", "/api/docs/alice/access", "/api/settings", "/api/jobs/anything"):
            with self.subTest(path=path):
                self.assertEqual(self.guest.get(path).status_code, 403)

    def test_guest_and_anonymous_cannot_write_or_upload(self):
        self.share(); self.unlock()
        for client in (self.guest, self.anonymous):
            for method, path, options in (
                ("POST", "/api/jobs", {"data": {"demo": "1"}}),
                ("PUT", "/api/docs/alice", {"json": {"name": "hacked", "annotations": []}}),
                ("DELETE", "/api/docs/alice", {}),
                ("PUT", "/api/docs/alice/access", {"json": {"password": "hacked-password"}}),
                ("POST", "/api/settings", {"json": {"deepseek_key": "hacked"}}),
            ):
                with self.subTest(method=method, path=path):
                    self.assertEqual(client.request(method, path, **options).status_code, 403)
        self.assertEqual(self.admin.get("/api/docs/alice").json()["name"], "alice")

    def test_wrong_password_cannot_grant_access(self):
        self.share()
        self.assertEqual(self.unlock(password="wrong", doc_id="alice").status_code, 401)
        self.assertEqual(self.unlock(doc_id="bob").status_code, 401)
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 403)

    def test_old_docs_locked_until_admin_sets_password(self):
        self.assertEqual(self.unlock().status_code, 401)
        self.assertEqual(self.admin.get("/api/docs/alice/access").json(), {"enabled": False})

    def test_password_rotation_and_disable_revoke_existing_sessions(self):
        self.share(); self.unlock()
        self.share(password="replacement-password")
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 403)
        self.assertEqual(self.unlock().status_code, 401)
        self.assertEqual(self.unlock(password="replacement-password").status_code, 200)
        self.assertEqual(self.admin.put("/api/docs/alice/access", json={"enabled": False}).status_code, 200)
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 403)
        self.assertEqual(self.unlock(password="replacement-password").status_code, 401)
        self.assertEqual(self.guest.get("/api/auth/session").json()["role"], "anonymous")

    def test_credentials_are_hashed_and_private_even_after_unlock(self):
        self.share(); self.unlock()
        stored = (main.doc_dir("alice") / "access.json").read_text()
        self.assertNotIn("alice-private-pass", stored)
        self.assertNotIn("password", self.guest.get("/api/docs/alice").text)
        for client in (self.guest, self.admin):
            for name in ("access.json", "doc.json", "transcript.md"):
                self.assertEqual(client.get(f"/data/alice/{name}").status_code, 404)

    def test_passwords_are_unique_and_have_minimum_length(self):
        self.assertEqual(self.admin.put("/api/docs/alice/access", json={"password": "short"}).status_code, 400)
        self.share()
        self.assertEqual(self.admin.put("/api/docs/bob/access", json={"password": "alice-private-pass"}).status_code, 400)

    def test_cookie_logout_and_expiration(self):
        self.share()
        r = self.unlock()
        cookie = r.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie); self.assertIn("SameSite=strict", cookie)
        token = self.guest.cookies.get(auth.COOKIE)
        self.guest.post("/api/auth/logout")
        self.assertNotIn(token, auth.SESSIONS)
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 403)
        self.unlock()
        auth.SESSIONS[self.guest.cookies.get(auth.COOKIE)]["expires"] = time.time() - 1
        self.assertEqual(self.guest.get("/api/docs/alice").status_code, 403)

    def test_rate_limit_and_cross_site_requests(self):
        for _ in range(10):
            self.assertEqual(self.unlock(password="wrong").status_code, 401)
        self.assertEqual(self.unlock().status_code, 429)
        for headers in ({"origin": "https://attacker.example"}, {"sec-fetch-site": "cross-site"}):
            self.assertEqual(self.admin.put("/api/docs/alice", json={"name": "cross-site"}, headers=headers).status_code, 403)

    def test_no_default_admin_and_changed_admin_password_revokes_session(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "changed-password"}):
            self.assertEqual(self.admin.get("/api/docs").status_code, 403)
        with patch.object(main.config, "get", return_value=""):
            self.assertEqual(self.anonymous.post("/api/auth/login", json={"password": "anything"}).status_code, 503)
        self.assertEqual(self.anonymous.post("/api/auth/login", json={"password": "wrong"}).status_code, 401)

    def test_pdf_export_removed(self):
        self.assertEqual(self.admin.get("/api/docs/alice/pdf").status_code, 404)
        self.assertEqual(self.admin.get("/print.html").status_code, 404)


if __name__ == "__main__":
    unittest.main()
