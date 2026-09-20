from fastapi.testclient import TestClient

from tts_server import ENGLISH_VOICES, MODEL, app


def test_health_does_not_load_the_model():
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["model"] == MODEL
    assert response.json()["loaded"] is False


def test_lists_only_supported_english_presets_separately():
    response = TestClient(app).get("/v1/voices")

    assert response.status_code == 200
    assert response.json()["english"] == list(ENGLISH_VOICES)


def test_rejects_non_english_requests_without_loading_the_model():
    response = TestClient(app).post(
        "/v1/audio/speech",
        json={"input": "hello", "voice": "Ryan", "language": "hindi"},
    )

    assert response.status_code == 422
