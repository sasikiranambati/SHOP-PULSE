from sqlalchemy import Column, String, Integer, Boolean, DateTime
from sqlalchemy.sql import func

from db.session import Base

class ProductCategory(Base):
    __tablename__ = "product_categories"

    code = Column(String(32), primary_key=True, index=True)
    name = Column(String(64), nullable=False, unique=True, index=True)
    description = Column(String(255), nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
