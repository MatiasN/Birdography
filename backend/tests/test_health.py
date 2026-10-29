def test_health_reports_postgis(anon):
    body = anon.get("/health").json()
    assert body["status"] == "ok"
    assert body["postgis"]
