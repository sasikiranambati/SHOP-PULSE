import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Index, func as sa_func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = (
        # One supplier per name in a shop, ignoring case and surrounding spaces (invoice confirmation
        # already matches suppliers this way); makes concurrent "new supplier" confirmations safe.
        Index("uq_suppliers_shop_name_ci", "shop_id", sa_func.lower(sa_func.trim(text("supplier_name"))), unique=True),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    supplier_name = Column(String, index=True, nullable=False)
    phone = Column(String, nullable=True)
    address = Column(String, nullable=True)
    shop_id = Column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    shop = relationship("Shop", back_populates="suppliers")
    products = relationship("Product", back_populates="supplier")
