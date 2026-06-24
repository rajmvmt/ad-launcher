from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from datetime import datetime

class ProductBase(BaseModel):
    name: str
    description: Optional[str] = None
    product_shots: Optional[List[str]] = []

class ProductCreate(ProductBase):
    id: Optional[str] = None

class Product(ProductBase):
    id: str
    brand_id: str
    created_at: datetime

    class Config:
        from_attributes = True

class BrandColors(BaseModel):
    primary: str
    secondary: str
    highlight: str

class BrandBase(BaseModel):
    name: str
    logo: Optional[str] = None
    voice: Optional[str] = None

class BrandCreate(BaseModel):
    id: Optional[str] = None
    name: str
    logo: Optional[str] = None
    voice: Optional[str] = None
    style_guide: Optional[Dict[str, Any]] = None
    colors: BrandColors
    products: Optional[List[ProductCreate]] = []
    profileIds: Optional[List[str]] = []

class BrandUpdate(BrandCreate):
    pass

class Brand(BrandBase):
    id: str
    colors: BrandColors
    style_guide: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    products: List[Product] = []
    profileIds: List[str] = []

    class Config:
        from_attributes = True
