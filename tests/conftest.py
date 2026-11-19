import json
from pathlib import Path

import pytest


@pytest.fixture
def payload():
    return json.loads(Path('examples/01_read.json').read_text(encoding='utf-8'))
