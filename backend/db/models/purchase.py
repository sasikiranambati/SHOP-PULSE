import uuid
from sqlalchemy import Column, Float, DateTime, ForeignKey, Index, String, UniqueConstraint, cast, func as sa_func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from db.session import Base

class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (
        UniqueConstraint("shop_id", "supplier_id", "invoice_number", name="uq_purchases_shop_supplier_invoice"),
        # Invoice identity as the duplicate check sees it (Stage 4C.1 verification): a missing supplier is
        # one identity (NULLs are otherwise distinct in a unique constraint) and the number is compared
        # ignoring case and surrounding spaces. Purchases without an invoice number are not restricted.
        Index(
            "uq_purchases_invoice_identity",
            "shop_id",
            sa_func.coalesce(cast(text("supplier_id"), String), ""),
            sa_func.lower(sa_func.trim(text("invoice_number"))),
            unique=True,
            sqlite_where=text("invoice_number IS NOT NULL AND trim(invoice_number) <> ''"),
            postgresql_where=text("invoice_number IS NOT NULL AND trim(invoice_number) <> ''"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    shop_id = Column(UUID(as_uuid=True), ForeignKey("shops.id"), nullable=False, index=True)
    supplier_id = Column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=True, index=True)
    total_amount = Column(Float, nullable=False, default=0.0)
    invoice_number = Column(String, nullable=True, index=True)
    invoice_date = Column(String, nullable=True)
    processing_status = Column(String, nullable=True, default="CONFIRMED")
    review_status = Column(String, nullable=True, default="REVIEWED")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    shop = relationship("Shop", back_populates="purchases")
    supplier = relationship("Supplier")
    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")

    @property
    def supplier_name(self):
        """Supplier name for API responses (read-only; not a database column)."""
        return self.supplier.supplier_name if self.supplier else None
