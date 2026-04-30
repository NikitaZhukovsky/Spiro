from fastapi import FastAPI
from api.users import auth, patients, file_views
from api.respiratory_analysis import router as respiratory_analysis_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from fastapi.security import OAuth2PasswordBearer


app = FastAPI(
    title="Respiratory Analysis System API",
    description="Система для анализа дыхательных движений пациентов",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    swagger_ui_init_oauth={
        "usePkceWithAuthorizationCodeGrant": True,
        "clientId": "swagger-ui",
    }
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(file_views.router)
app.include_router(patients.router)
app.include_router(respiratory_analysis_router)

