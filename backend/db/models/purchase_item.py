import uuid
from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    purchase_id = Column(UUID(as_uuid=True), ForeignKey("purchases.id"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    purchase_price = Column(Float, nullable=False)
    # Amount printed on the invoice line (after discount/tax as invoiced); NULL if not provided
    line_amount = Column(Float, nullable=True)
    mrp = Column(Float, nullable=True)
    mrp_source = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")

    @property
    def product_name(self):
        """Product name for API responses (read-only; not a database column)."""
        return self.product.name if self.product else None

    @property
    def product_unit(self):
        return self.product.unit if self.product else None
