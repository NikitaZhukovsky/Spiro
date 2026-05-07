#!/bin/bash
cd /opt/render/project/src/src

alembic upgrade head

uvicorn drivers.main:app --host 0.0.0.0 --port $PORT