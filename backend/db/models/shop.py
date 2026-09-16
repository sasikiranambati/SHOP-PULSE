import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class Shop(Base):
    __tablename__ = "shops"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    shop_name = Column(String, index=True, nullable=False)
    owner_name = Column(String, nullable=False)
    business_type = Column(String, nullable=False)
    location = Column(String, nullable=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    owner = relationship("User", back_populates="shops")
    suppliers = relationship("Supplier", back_populates="shop")
    products = relationship("Product", back_populates="shop")
    sales = relationship("Sale", back_populates="shop")
    purchases = relationship("Purchase", back_populates="shop")
