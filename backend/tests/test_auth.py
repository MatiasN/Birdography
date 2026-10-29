from tests.conftest import login


def test_me(client):
    assert client.get("/auth/me").json()["email"] == "me@example.com"


def test_wrong_password(client, anon):
    assert anon.post("/auth/login", json={"email": "me@example.com", "password": "nope"}).status_code == 401


def test_bearer_token(client, anon):
    token = anon.post("/auth/login", json={"email": "ME@example.com", "password": "secret"}).json()["access_token"]
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_routes_require_login(anon):
    for path in ["/photos", "/species", "/locations", "/auth/me"]:
        assert anon.get(path).status_code == 401
    assert anon.get("/health").status_code == 200


def test_logout(client):
    client.post("/auth/logout")
    assert client.get("/auth/me").status_code == 401


def test_registration_disabled_by_default(anon):
    assert anon.post("/auth/register", json={"email": "new@example.com", "password": "x"}).status_code == 403


def test_users_cannot_see_each_others_data(client):
    photo = client.post("/photos", files={"file": ("bird.jpg", b"x", "image/jpeg")}).json()
    location = client.post("/locations", json={"name": "Home", "lat": 0, "lon": 0}).json()

    other = login("other@example.com")
    assert other.get("/photos").json() == []
    assert other.get(f"/photos/{photo['id']}").status_code == 404
    assert other.get(f"/photos/{photo['id']}/file").status_code == 404
    assert other.get(f"/locations/{location['id']}").status_code == 404

    own = other.post("/photos", files={"file": ("mine.jpg", b"x", "image/jpeg")}).json()
    assert other.patch(f"/photos/{own['id']}", json={"location_id": location["id"]}).status_code == 400
