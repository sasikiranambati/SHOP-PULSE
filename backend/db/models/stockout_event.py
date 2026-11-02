import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class StockoutEvent(Base):
    __tablename__ = "stockout_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    shop_id = Column(UUID(as_uuid=True), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    reason = Column(String(64), nullable=True)  # e.g., 'DEPLETED_BY_SALE', 'MANUAL_COUNT', 'EXPIRED'
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shop = relationship("Shop", back_populates="stockout_events")
    product = relationship("Product", back_populates="stockout_events")

    __table_args__ = (
        Index("ix_stockout_events_shop_product", "shop_id", "product_id"),
        Index("ix_stockout_events_active", "shop_id", "product_id", "ended_at"),
    )
