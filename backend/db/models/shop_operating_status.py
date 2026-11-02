import uuid
from sqlalchemy import Column, String, Boolean, Date, Time, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class ShopOperatingStatus(Base):
    __tablename__ = "shop_operating_status"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    shop_id = Column(UUID(as_uuid=True), ForeignKey("shops.id", ondelete="CASCADE"), nullable=False, index=True)
    operating_date = Column(Date, nullable=False, index=True)
    is_open = Column(Boolean, nullable=False, default=True)
    opening_time = Column(Time, nullable=True)
    closing_time = Column(Time, nullable=True)
    closure_reason = Column(String(64), nullable=True)  # e.g., 'WEEKLY_OFF', 'FESTIVAL', 'PERSONAL', 'EMERGENCY', 'PUBLIC_HOLIDAY'
    notes = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    shop = relationship("Shop", back_populates="operating_statuses")

    __table_args__ = (
        UniqueConstraint("shop_id", "operating_date", name="uq_shop_operating_date"),
        Index("ix_shop_op_date_lookup", "shop_id", "operating_date"),
    )
