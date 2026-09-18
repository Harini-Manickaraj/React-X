from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, TokenResponse
from app.auth import hash_password, verify_password, create_access_token, _nameFromEmail

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered.")
    user = User(
        name=payload.name.strip(),
        email=payload.email.lower().strip(),
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": user.id, "email": user.email})
    return {"access_token": token, "user": {"id": user.id, "name": user.name, "email": user.email}}


@router.post("/login", response_model=TokenResponse)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()
    # Demo mode: accept any email+password, create user if not found
    if not user:
        from app.auth import _nameFromEmail
        name = _nameFromEmail(payload.email)
        user = User(
            name=name,
            email=payload.email.lower().strip(),
            hashed_password=hash_password(payload.password),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif not verify_password(payload.password, user.hashed_password):
        # Demo mode: accept any password for existing users too
        pass
    token = create_access_token({"sub": user.id, "email": user.email})
    return {"access_token": token, "user": {"id": user.id, "name": user.name, "email": user.email}}


@router.get("/me")
async def me(db: AsyncSession = Depends(get_db)):
    # Frontend passes token in Authorization header — handled by middleware
    return {"message": "Use Authorization: Bearer <token>"}
