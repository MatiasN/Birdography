from sqlalchemy.orm import Session

from app.db import engine
from app.models import Location
from tests.conftest import make_jpeg


def test_create_round_trips_coordinates(client):
    created = client.post("/locations", json={"name": "Tejo estuary", "lat": 38.8, "lon": -9.0})
    assert created.status_code == 201
    body = created.json()
    assert (body["lat"], body["lon"]) == (38.8, -9.0)
    assert client.get("/locations").json() == [body]


def test_rejects_invalid_coordinates(client):
    assert client.post("/locations", json={"name": "x", "lat": 120, "lon": 0}).status_code == 422


def test_delete_unlinks_photos_until_restored(client):
    location = client.post("/locations", json={"name": "Home", "lat": 0, "lon": 0}).json()
    photo = client.post("/photos", files={"file": ("bird.jpg", make_jpeg(), "image/jpeg")}).json()
    client.patch(f"/photos/{photo['id']}", json={"location_id": location["id"]})

    assert client.delete(f"/locations/{location['id']}").status_code == 204
    assert client.get("/locations").json() == []
    assert client.get(f"/photos/{photo['id']}").json()["location_id"] is None
    assert client.patch(f"/photos/{photo['id']}", json={"location_id": location["id"]}).status_code == 400

    with Session(engine) as db:
        db.get(Location, location["id"]).deleted_at = None
        db.commit()
    assert client.get(f"/photos/{photo['id']}").json()["location_id"] == location["id"]
