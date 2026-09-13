export { BUSINESS_TYPE_OPTIONS } from './mockData/businessTypes';
export { STORE_TEMPLATES, getMockDataForBusiness } from './mockData/storeTemplates';

import { STORE_TEMPLATES } from './mockData/storeTemplates';
import type { Product, ActionRecommendation, RecentSale } from '../types';

export const INITIAL_PRODUCTS: Product[] = STORE_TEMPLATES.grocery.products;
export const MOCK_RECOMMENDATIONS: ActionRecommendation[] = STORE_TEMPLATES.grocery.recommendations;
export const MOCK_RECENT_SALES: RecentSale[] = STORE_TEMPLATES.grocery.recentSales;
export const PRODUCT_CATEGORIES = ['All', 'Dairy', 'Staples', 'Snacks', 'Beverages', 'Bakery', 'General'];
