from app.main import app


def test_api_uses_listflick_brand_name():
    assert app.title == "ListFlick API"
