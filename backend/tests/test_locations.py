def test_create_round_trips_coordinates(client):
    created = client.post("/locations", json={"name": "Tejo estuary", "lat": 38.8, "lon": -9.0})
    assert created.status_code == 201
    body = created.json()
    assert (body["lat"], body["lon"]) == (38.8, -9.0)
    assert client.get("/locations").json() == [body]


def test_rejects_invalid_coordinates(client):
    assert client.post("/locations", json={"name": "x", "lat": 120, "lon": 0}).status_code == 422
