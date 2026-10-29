def test_health_reports_postgis(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["postgis"]
