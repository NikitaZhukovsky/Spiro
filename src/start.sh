#!/bin/bash
cd /opt/render/project/src/src
uvicorn drivers.main:app --host 0.0.0.0 --port $PORT