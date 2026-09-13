import type { BusinessTypeId, Product, ActionRecommendation, RecentSale } from '../../types';

export interface StoreMockData {
  products: Product[];
  recommendations: ActionRecommendation[];
  recentSales: RecentSale[];
  topSelling: Array<{ rank: number; name: string; sold: string; revenue: string }>;
}

export const STORE_TEMPLATES: Record<BusinessTypeId, StoreMockData> = {
  grocery: {
    products: [
      { id: 'g1', name: 'Toned Milk (500ml)', category: 'Dairy', price: 28, purchasePrice: 24, stock: 50, minStock: 20, unit: 'pkts', supplier: 'Mother Dairy Co.', status: 'In Stock' },
      { id: 'g2', name: 'Basmati Rice (5kg)', category: 'Staples', price: 450, purchasePrice: 380, stock: 18, minStock: 5, unit: 'bags', supplier: 'India Gate Wholesale', status: 'In Stock' },
      { id: 'g3', name: 'Refined Sugar (1kg)', category: 'Staples', price: 48, purchasePrice: 40, stock: 35, minStock: 10, unit: 'bags', supplier: 'Madan Sugar Agency', status: 'In Stock' },
      { id: 'g4', name: 'Sunflower Cooking Oil (1L)', category: 'Staples', price: 145, purchasePrice: 120, stock: 22, minStock: 8, unit: 'pouches', supplier: 'Fortune Distro', status: 'In Stock' },
      { id: 'g5', name: 'Marie Gold Biscuits (200g)', category: 'Snacks', price: 25, purchasePrice: 19, stock: 100, minStock: 25, unit: 'packs', supplier: 'Britannia Agency', status: 'In Stock' },
      { id: 'g6', name: 'Fresh White Bread (400g)', category: 'Bakery', price: 45, purchasePrice: 32, stock: 4, minStock: 15, unit: 'packets', supplier: 'Modern Bakers', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'r1', type: 'warning', productName: 'Fresh White Bread', message: 'Daily demand peak expected at 5:00 PM.', recommendedOrder: 'Order 20 packets from Modern Bakers' },
      { id: 'r2', type: 'urgent', productName: 'Toned Milk (500ml)', message: 'Stock level will reach zero by tomorrow morning.', recommendedOrder: 'Restock 40 packets' }
    ],
    recentSales: [
      { id: 's1', items: '2x Toned Milk, 1x White Bread', total: 101, time: '10 mins ago' },
      { id: 's2', items: '1x Sunflower Oil, 2x Sugar (1kg)', total: 241, time: '25 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Toned Milk (500ml)', sold: '140 pkts', revenue: '₹3,920' },
      { rank: 2, name: 'Marie Gold Biscuits', sold: '85 packs', revenue: '₹2,125' },
      { rank: 3, name: 'Basmati Rice (5kg)', sold: '12 bags', revenue: '₹5,400' },
    ]
  },

  bakery: {
    products: [
      { id: 'b1', name: 'Fresh White Bread (400g)', category: 'Breads', price: 40, purchasePrice: 28, stock: 18, minStock: 10, unit: 'loaves', supplier: 'Local Oven Supplier', status: 'In Stock' },
      { id: 'b2', name: 'Butter Pav Buns (Pack of 6)', category: 'Breads', price: 30, purchasePrice: 20, stock: 6, minStock: 15, unit: 'packs', supplier: 'Metro Flour Mills', status: 'Low Stock' },
      { id: 'b3', name: 'Butter Croissants', category: 'Pastries', price: 65, purchasePrice: 42, stock: 12, minStock: 8, unit: 'pcs', supplier: 'Artisan Pastry Co.', status: 'In Stock' },
      { id: 'b4', name: 'Rich Chocolate Truffle Cake (1kg)', category: 'Cakes', price: 650, purchasePrice: 420, stock: 3, minStock: 2, unit: 'cakes', supplier: 'In-House Bakery', status: 'In Stock' },
      { id: 'b5', name: 'Black Forest Pastry', category: 'Pastries', price: 75, purchasePrice: 48, stock: 8, minStock: 10, unit: 'slices', supplier: 'In-House Bakery', status: 'Low Stock' },
      { id: 'b6', name: 'Choco Chip Cookies (250g)', category: 'Biscuits', price: 120, purchasePrice: 85, stock: 25, minStock: 10, unit: 'boxes', supplier: 'Crown Bakers', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rb1', type: 'warning', productName: 'Butter Pav Buns', message: 'High evening tea-time demand expected.', recommendedOrder: 'Order 30 packs before 2:00 PM' },
      { id: 'rb2', type: 'urgent', productName: 'Chocolate Truffle Cake', message: 'Only 3 units left for weekend orders.', recommendedOrder: 'Bake 5 fresh cakes' }
    ],
    recentSales: [
      { id: 'sb1', items: '2x White Bread, 4x Pav Buns', total: 200, time: '8 mins ago' },
      { id: 'sb2', items: '1x Choco Truffle Cake', total: 650, time: '30 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Fresh White Bread', sold: '95 loaves', revenue: '₹3,800' },
      { rank: 2, name: 'Choco Chip Cookies', sold: '42 boxes', revenue: '₹5,040' },
      { rank: 3, name: 'Butter Croissants', sold: '38 pcs', revenue: '₹2,470' },
    ]
  },

  pharmacy: {
    products: [
      { id: 'p1', name: 'Paracetamol 650mg (Strip of 15)', category: 'Medicines', price: 30, purchasePrice: 20, stock: 15, minStock: 20, unit: 'strips', supplier: 'ABC Pharma Distro', status: 'Low Stock' },
      { id: 'p2', name: 'Vitamin C 500mg Chewable', category: 'Supplements', price: 85, purchasePrice: 55, stock: 40, minStock: 15, unit: 'bottles', supplier: 'HealthCare Wholesale', status: 'In Stock' },
      { id: 'p3', name: 'Cough Syrup 100ml', category: 'Medicines', price: 110, purchasePrice: 78, stock: 8, minStock: 12, unit: 'bottles', supplier: 'Sun Med Agencies', status: 'Low Stock' },
      { id: 'p4', name: 'Antiseptic Liquid 250ml', category: 'First Aid', price: 95, purchasePrice: 68, stock: 22, minStock: 8, unit: 'bottles', supplier: 'Dettol Distro', status: 'In Stock' },
      { id: 'p5', name: 'Waterproof Bandages (Box of 100)', category: 'First Aid', price: 150, purchasePrice: 105, stock: 14, minStock: 5, unit: 'boxes', supplier: 'Medical Surgicals', status: 'In Stock' },
      { id: 'p6', name: 'Digital Infrared Thermometer', category: 'Devices', price: 990, purchasePrice: 680, stock: 5, minStock: 3, unit: 'units', supplier: 'Omron Pharma', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rp1', type: 'urgent', productName: 'Paracetamol 650mg', message: 'Current stock below minimum reorder threshold.', recommendedOrder: 'Order 50 strips from ABC Pharma' },
      { id: 'rp2', type: 'warning', productName: 'Cough Syrup 100ml', message: 'Seasonal flu wave increasing prescription sales.', recommendedOrder: 'Reorder 25 bottles' }
    ],
    recentSales: [
      { id: 'sp1', items: '2x Paracetamol, 1x Vitamin C', total: 145, time: '5 mins ago' },
      { id: 'sp2', items: '1x Cough Syrup, 1x Bandages Box', total: 260, time: '18 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Paracetamol 650mg', sold: '210 strips', revenue: '₹6,300' },
      { rank: 2, name: 'Vitamin C Chewables', sold: '65 bottles', revenue: '₹5,525' },
      { rank: 3, name: 'Antiseptic Liquid', sold: '48 bottles', revenue: '₹4,560' },
    ]
  },

  teaCoffee: {
    products: [
      { id: 'tc1', name: 'Premium Assam Tea Powder (1kg)', category: 'Tea Raw Material', price: 420, purchasePrice: 310, stock: 12, minStock: 5, unit: 'kg', supplier: 'Assam Tea Estate', status: 'In Stock' },
      { id: 'tc2', name: 'Arabica Coffee Beans (500g)', category: 'Coffee Raw Material', price: 380, purchasePrice: 270, stock: 8, minStock: 4, unit: 'packs', supplier: 'Coorg Coffee Distro', status: 'In Stock' },
      { id: 'tc3', name: 'Refined Sugar Bags (5kg)', category: 'Dairy Supplies', price: 230, purchasePrice: 190, stock: 4, minStock: 5, unit: 'bags', supplier: 'Local Sugar Mill', status: 'Low Stock' },
      { id: 'tc4', name: 'Full Cream Milk Pouch (1L)', category: 'Dairy Supplies', price: 62, purchasePrice: 52, stock: 45, minStock: 20, unit: 'liters', supplier: 'Amul Dairy', status: 'In Stock' },
      { id: 'tc5', name: 'Crispy Butter Biscuits', category: 'Snacks', price: 15, purchasePrice: 9, stock: 120, minStock: 30, unit: 'packs', supplier: 'Tea Snack Bakers', status: 'In Stock' },
      { id: 'tc6', name: 'Paper Cups 150ml (Pack of 100)', category: 'Disposables', price: 85, purchasePrice: 55, stock: 6, minStock: 10, unit: 'packs', supplier: 'Eco Pack Agencies', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'rtc1', type: 'warning', productName: 'Paper Cups 150ml', message: 'Morning Rush hour consumes ~4 packs daily.', recommendedOrder: 'Order 20 packs' },
      { id: 'rtc2', type: 'urgent', productName: 'Refined Sugar Bags', message: 'Stock level critical for daily brewing.', recommendedOrder: 'Order 10 bags' }
    ],
    recentSales: [
      { id: 'stc1', items: '5x Hot Chai, 2x Butter Biscuits', total: 105, time: '3 mins ago' },
      { id: 'stc2', items: '2x Filter Coffee, 1x Snack Pack', total: 80, time: '12 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Special Masala Tea', sold: '380 cups', revenue: '₹5,700' },
      { rank: 2, name: 'Filter Coffee', sold: '190 cups', revenue: '₹4,750' },
      { rank: 3, name: 'Crispy Butter Biscuits', sold: '110 packs', revenue: '₹1,650' },
    ]
  },

  sweetShop: {
    products: [
      { id: 'sw1', name: 'Special Gulab Jamun (1kg)', category: 'Milk Sweets', price: 340, purchasePrice: 220, stock: 14, minStock: 8, unit: 'kg', supplier: 'In-House Sweet Kitchen', status: 'In Stock' },
      { id: 'sw2', name: 'Kaju Katli Premium (500g)', category: 'Dry Fruit Sweets', price: 480, purchasePrice: 340, stock: 5, minStock: 10, unit: 'boxes', supplier: 'In-House Sweet Kitchen', status: 'Low Stock' },
      { id: 'sw3', name: 'Ghee Mysore Pak (500g)', category: 'Milk Sweets', price: 320, purchasePrice: 210, stock: 18, minStock: 6, unit: 'boxes', supplier: 'In-House Sweet Kitchen', status: 'In Stock' },
      { id: 'sw4', name: 'Crispy Saffron Jalebi', category: 'Milk Sweets', price: 260, purchasePrice: 160, stock: 8, minStock: 5, unit: 'kg', supplier: 'Fresh Fry Counter', status: 'In Stock' },
      { id: 'sw5', name: 'Besan Motichoor Laddu (1kg)', category: 'Milk Sweets', price: 300, purchasePrice: 190, stock: 22, minStock: 8, unit: 'kg', supplier: 'In-House Sweet Kitchen', status: 'In Stock' },
      { id: 'sw6', name: 'Festive Sweet Gift Box', category: 'Festive Boxes', price: 750, purchasePrice: 480, stock: 4, minStock: 10, unit: 'boxes', supplier: 'Packaging Dept', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'rsw1', type: 'urgent', productName: 'Kaju Katli Premium', message: 'Festive orders spiking this week.', recommendedOrder: 'Prepare 20 additional 500g boxes' },
      { id: 'rsw2', type: 'warning', productName: 'Sweet Gift Boxes', message: 'Corporate gift inquiries logged today.', recommendedOrder: 'Restock 30 gift boxes' }
    ],
    recentSales: [
      { id: 'ssw1', items: '1x Kaju Katli (500g), 1x Gulab Jamun (1kg)', total: 820, time: '15 mins ago' },
      { id: 'ssw2', items: '2x Festive Gift Boxes', total: 1500, time: '40 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Kaju Katli Premium', sold: '65 boxes', revenue: '₹31,200' },
      { rank: 2, name: 'Ghee Mysore Pak', sold: '52 boxes', revenue: '₹16,640' },
      { rank: 3, name: 'Motichoor Laddu', sold: '40 kg', revenue: '₹12,000' },
    ]
  },

  fruitVegetables: {
    products: [
      { id: 'fv1', name: 'Fresh Red Tomatoes (1kg)', category: 'Fresh Vegetables', price: 40, purchasePrice: 28, stock: 45, minStock: 20, unit: 'kg', supplier: 'Mandi Farm Wholesale', status: 'In Stock' },
      { id: 'fv2', name: 'Jyoti Potatoes (1kg)', category: 'Fresh Vegetables', price: 30, purchasePrice: 21, stock: 80, minStock: 30, unit: 'kg', supplier: 'Mandi Farm Wholesale', status: 'In Stock' },
      { id: 'fv3', name: 'Nasik Onions (1kg)', category: 'Fresh Vegetables', price: 35, purchasePrice: 24, stock: 12, minStock: 25, unit: 'kg', supplier: 'Mandi Farm Wholesale', status: 'Low Stock' },
      { id: 'fv4', name: 'Shimla Apples (1kg)', category: 'Seasonal Fruits', price: 180, purchasePrice: 130, stock: 15, minStock: 8, unit: 'kg', supplier: 'Fruit Import Traders', status: 'In Stock' },
      { id: 'fv5', name: 'Robusta Bananas (1 Dozen)', category: 'Seasonal Fruits', price: 60, purchasePrice: 42, stock: 8, minStock: 15, unit: 'doz', supplier: 'Local Fruit Farm', status: 'Low Stock' },
      { id: 'fv6', name: 'Ooty Carrots (1kg)', category: 'Fresh Vegetables', price: 55, purchasePrice: 38, stock: 20, minStock: 10, unit: 'kg', supplier: 'Nilgiri Farm Fresh', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rfv1', type: 'urgent', productName: 'Nasik Onions', message: 'Stock low. Highly perishable item daily demand high.', recommendedOrder: 'Procure 50kg from Mandi' },
      { id: 'rfv2', type: 'warning', productName: 'Robusta Bananas', message: 'Bananas stock will deplete by 2 PM.', recommendedOrder: 'Procure 20 dozen' }
    ],
    recentSales: [
      { id: 'sfv1', items: '2kg Tomatoes, 3kg Potatoes, 1kg Onions', total: 205, time: '6 mins ago' },
      { id: 'sfv2', items: '1kg Shimla Apples, 1 Doz Bananas', total: 240, time: '22 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Fresh Red Tomatoes', sold: '180 kg', revenue: '₹7,200' },
      { rank: 2, name: 'Jyoti Potatoes', sold: '240 kg', revenue: '₹7,200' },
      { rank: 3, name: 'Shimla Apples', sold: '65 kg', revenue: '₹11,700' },
    ]
  },

  mobileAccessories: {
    products: [
      { id: 'ma1', name: 'Fast Charging Type-C USB Cable', category: 'Chargers & Cables', price: 199, purchasePrice: 85, stock: 35, minStock: 10, unit: 'pcs', supplier: 'Shenzhen Electronics', status: 'In Stock' },
      { id: 'ma2', name: '20W Fast Wall Adapter Charger', category: 'Chargers & Cables', price: 499, purchasePrice: 240, stock: 8, minStock: 12, unit: 'pcs', supplier: 'Apex Mobile Imports', status: 'Low Stock' },
      { id: 'ma3', name: 'In-Ear Bass Earphones 3.5mm', category: 'Audio Devices', price: 299, purchasePrice: 120, stock: 25, minStock: 8, unit: 'pcs', supplier: 'SoundTech Distro', status: 'In Stock' },
      { id: 'ma4', name: '10,000mAh Compact Power Bank', category: 'Power & Storage', price: 999, purchasePrice: 620, stock: 4, minStock: 6, unit: 'units', supplier: 'Mi Accessories Agency', status: 'Low Stock' },
      { id: 'ma5', name: 'Universal Silicon Phone Case', category: 'Protection & Cases', price: 149, purchasePrice: 45, stock: 60, minStock: 15, unit: 'pcs', supplier: 'City Mobile Market', status: 'In Stock' },
      { id: 'ma6', name: '9H Tempered Glass Screen Guard', category: 'Protection & Cases', price: 99, purchasePrice: 22, stock: 110, minStock: 25, unit: 'pcs', supplier: 'City Mobile Market', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rma1', type: 'urgent', productName: '20W Wall Adapter Charger', message: 'Top margin item running low on stock.', recommendedOrder: 'Order 30 units' },
      { id: 'rma2', type: 'warning', productName: '10,000mAh Power Bank', message: 'Weekend travelers driving power bank sales.', recommendedOrder: 'Order 15 units' }
    ],
    recentSales: [
      { id: 'sma1', items: '1x Type-C Cable, 1x Screen Guard', total: 298, time: '14 mins ago' },
      { id: 'sma2', items: '1x 20W Charger, 1x Silicon Case', total: 648, time: '35 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: '9H Tempered Glass', sold: '140 pcs', revenue: '₹13,860' },
      { rank: 2, name: 'Type-C USB Cable', sold: '85 pcs', revenue: '₹16,915' },
      { rank: 3, name: '20W Wall Adapter', sold: '42 pcs', revenue: '₹20,958' },
    ]
  },

  stationery: {
    products: [
      { id: 'st1', name: 'Long Book 200 Pages Ruled', category: 'Notebooks', price: 60, purchasePrice: 38, stock: 85, minStock: 30, unit: 'books', supplier: 'Classmate Paper Mills', status: 'In Stock' },
      { id: 'st2', name: 'Blue Gel Pens (Pack of 5)', category: 'Writing Tools', price: 50, purchasePrice: 28, stock: 12, minStock: 20, unit: 'packs', supplier: 'Reynolds Agency', status: 'Low Stock' },
      { id: 'st3', name: 'HB Graphite Pencils (Box of 10)', category: 'Writing Tools', price: 40, purchasePrice: 24, stock: 45, minStock: 15, unit: 'boxes', supplier: 'Camlin Distro', status: 'In Stock' },
      { id: 'st4', name: 'Plastic Document Folder File', category: 'Office Supplies', price: 35, purchasePrice: 18, stock: 60, minStock: 15, unit: 'files', supplier: 'Solo Office Supplies', status: 'In Stock' },
      { id: 'st5', name: 'A4 Copier Paper Rim 75GSM (500 Sheets)', category: 'Paper Products', price: 280, purchasePrice: 215, stock: 5, minStock: 10, unit: 'rims', supplier: 'JK Paper Distro', status: 'Low Stock' },
      { id: 'st6', name: 'NCERT Grade 10 Science Textbook', category: 'Paper Products', price: 165, purchasePrice: 135, stock: 18, minStock: 5, unit: 'copies', supplier: 'National Book Depot', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rst1', type: 'urgent', productName: 'A4 Copier Paper Rims', message: 'Exam season printing spike in progress.', recommendedOrder: 'Restock 20 paper rims' },
      { id: 'rst2', type: 'warning', productName: 'Blue Gel Pens', message: 'Pen sets below reorder threshold.', recommendedOrder: 'Order 50 packs' }
    ],
    recentSales: [
      { id: 'sst1', items: '2x Long Books, 1x Gel Pen Pack', total: 170, time: '11 mins ago' },
      { id: 'sst2', items: '1x A4 Paper Rim, 2x Document Files', total: 350, time: '45 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Long Book 200 Pages', sold: '210 books', revenue: '₹12,600' },
      { rank: 2, name: 'A4 Copier Paper Rims', sold: '45 rims', revenue: '₹12,600' },
      { rank: 3, name: 'Blue Gel Pens (Pack 5)', sold: '80 packs', revenue: '₹4,000' },
    ]
  },

  hardware: {
    products: [
      { id: 'hw1', name: 'Steel Wood Screws 1.5 inch (Box 100)', category: 'Fasteners', price: 120, purchasePrice: 75, stock: 30, minStock: 10, unit: 'boxes', supplier: 'Apex Fasteners Ltd', status: 'In Stock' },
      { id: 'hw2', name: 'Iron Construction Nails (1kg)', category: 'Fasteners', price: 95, purchasePrice: 68, stock: 8, minStock: 15, unit: 'kg', supplier: 'Metro Steel Mills', status: 'Low Stock' },
      { id: 'hw3', name: 'Masonry Drill Bits Set (5 Pcs)', category: 'Tools & Bits', price: 290, purchasePrice: 180, stock: 14, minStock: 5, unit: 'sets', supplier: 'Bosch Hardware Distro', status: 'In Stock' },
      { id: 'hw4', name: 'Heavy PVC Pipe 1 Inch (10ft)', category: 'Plumbing', price: 185, purchasePrice: 130, stock: 25, minStock: 8, unit: 'pipes', supplier: 'Supreme Pipes Agency', status: 'In Stock' },
      { id: 'hw5', name: 'Brass Water Tap 1/2 Inch', category: 'Plumbing', price: 340, purchasePrice: 240, stock: 4, minStock: 8, unit: 'pcs', supplier: 'Jaquar Hardware', status: 'Low Stock' },
      { id: 'hw6', name: 'Quick Bond Adhesive Fluid (100ml)', category: 'Paints & Adhesives', price: 85, purchasePrice: 52, stock: 40, minStock: 12, unit: 'bottles', supplier: 'Fevicol Distro', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rhw1', type: 'urgent', productName: 'Brass Water Tap 1/2 Inch', message: 'Plumbing repair demand peak on weekends.', recommendedOrder: 'Order 15 pcs' },
      { id: 'rhw2', type: 'warning', productName: 'Construction Nails (1kg)', message: 'Local contractor reorders expected.', recommendedOrder: 'Order 40 kg' }
    ],
    recentSales: [
      { id: 'shw1', items: '2x PVC Pipes, 1x Adhesive', total: 455, time: '20 mins ago' },
      { id: 'shw2', items: '1x Brass Tap, 1x Screws Box', total: 460, time: '50 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Heavy PVC Pipe 1 Inch', sold: '75 pipes', revenue: '₹13,875' },
      { rank: 2, name: 'Brass Water Tap', sold: '28 pcs', revenue: '₹9,520' },
      { rank: 3, name: 'Quick Bond Adhesive', sold: '90 bottles', revenue: '₹7,650' },
    ]
  },

  electrical: {
    products: [
      { id: 'el1', name: '9W Cool Day LED Bulb B22', category: 'Lighting & LED', price: 90, purchasePrice: 55, stock: 65, minStock: 20, unit: 'pcs', supplier: 'Syska LED Wholesale', status: 'In Stock' },
      { id: 'el2', name: 'Modular 6A Electrical Switch', category: 'Switches & Wiring', price: 45, purchasePrice: 26, stock: 12, minStock: 25, unit: 'pcs', supplier: 'Anchor Electricals', status: 'Low Stock' },
      { id: 'el3', name: 'Modular 3-Pin Socket 16A', category: 'Switches & Wiring', price: 95, purchasePrice: 62, stock: 24, minStock: 10, unit: 'pcs', supplier: 'Havells Distro', status: 'In Stock' },
      { id: 'el4', name: 'FR Copper Wire 1.5 sqmm (90m Roll)', category: 'Switches & Wiring', price: 1450, purchasePrice: 1120, stock: 6, minStock: 5, unit: 'rolls', supplier: 'Polycab Wires', status: 'In Stock' },
      { id: 'el5', name: '4-Way Extension Board 2m', category: 'Extension Boards', price: 340, purchasePrice: 215, stock: 4, minStock: 8, unit: 'units', supplier: 'Anchor Electricals', status: 'Low Stock' },
      { id: 'el6', name: 'B22 Ceiling Lamp Holder', category: 'Electrical Accessories', price: 35, purchasePrice: 18, stock: 50, minStock: 15, unit: 'pcs', supplier: 'Local Molders', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'rel1', type: 'urgent', productName: 'Modular 6A Switch', message: 'Residential electrician demand running high.', recommendedOrder: 'Order 100 pcs' },
      { id: 'rel2', type: 'warning', productName: '4-Way Extension Board', message: 'Work-from-home accessory reorder needed.', recommendedOrder: 'Order 15 units' }
    ],
    recentSales: [
      { id: 'sel1', items: '4x 9W LED Bulbs, 2x Lamp Holders', total: 430, time: '16 mins ago' },
      { id: 'sel2', items: '1x Copper Wire Roll, 4x 16A Sockets', total: 1830, time: '42 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: '9W Cool Day LED Bulb', sold: '180 pcs', revenue: '₹16,200' },
      { rank: 2, name: 'FR Copper Wire Roll', sold: '18 rolls', revenue: '₹26,100' },
      { rank: 3, name: 'Modular 6A Switch', sold: '130 pcs', revenue: '₹5,850' },
    ]
  },

  cosmetics: {
    products: [
      { id: 'cs1', name: 'Nourishing Shampoo 180ml', category: 'Haircare', price: 165, purchasePrice: 115, stock: 24, minStock: 8, unit: 'bottles', supplier: 'L’Oreal India Distro', status: 'In Stock' },
      { id: 'cs2', name: 'Gentle Neem Face Wash 100ml', category: 'Skincare', price: 130, purchasePrice: 88, stock: 6, minStock: 12, unit: 'tubes', supplier: 'Himalaya Wellness', status: 'Low Stock' },
      { id: 'cs3', name: 'Moisturizing Bath Soap (Pack of 3)', category: 'Personal Hygiene', price: 140, purchasePrice: 102, stock: 35, minStock: 10, unit: 'packs', supplier: 'Unilever Distro', status: 'In Stock' },
      { id: 'cs4', name: 'Daily Protection Moisturizer 100g', category: 'Skincare', price: 220, purchasePrice: 150, stock: 18, minStock: 5, unit: 'jars', supplier: 'Nivea India', status: 'In Stock' },
      { id: 'cs5', name: 'Complete Care Toothpaste 150g', category: 'Personal Hygiene', price: 95, purchasePrice: 68, stock: 40, minStock: 15, unit: 'packs', supplier: 'Colgate Distro', status: 'In Stock' },
      { id: 'cs6', name: 'Pure Coconut Hair Oil 200ml', category: 'Haircare', price: 110, purchasePrice: 82, stock: 7, minStock: 10, unit: 'bottles', supplier: 'Marico India', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'rcs1', type: 'urgent', productName: 'Gentle Neem Face Wash', message: 'Skincare items running low.', recommendedOrder: 'Order 30 tubes' },
      { id: 'rcs2', type: 'warning', productName: 'Pure Coconut Hair Oil', message: 'Restock needed for weekly hygiene basket.', recommendedOrder: 'Order 25 bottles' }
    ],
    recentSales: [
      { id: 'scs1', items: '1x Shampoo, 1x Face Wash', total: 295, time: '9 mins ago' },
      { id: 'scs2', items: '2x Bath Soap Packs, 1x Toothpaste', total: 375, time: '30 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Nourishing Shampoo', sold: '72 bottles', revenue: '₹11,880' },
      { rank: 2, name: 'Moisturizing Bath Soap', sold: '95 packs', revenue: '₹13,300' },
      { rank: 3, name: 'Daily Protection Moisturizer', sold: '40 jars', revenue: '₹8,800' },
    ]
  },

  household: {
    products: [
      { id: 'hh1', name: 'Front Load Detergent Powder (1kg)', category: 'Cleaners & Detergents', price: 215, purchasePrice: 160, stock: 28, minStock: 10, unit: 'packs', supplier: 'Surf Excel Distro', status: 'In Stock' },
      { id: 'hh2', name: 'Lemon Dishwash Gel 500ml', category: 'Dishwash', price: 115, purchasePrice: 80, stock: 5, minStock: 12, unit: 'bottles', supplier: 'Vim Gel Wholesale', status: 'Low Stock' },
      { id: 'hh3', name: 'Disinfectant Floor Cleaner (1L)', category: 'Cleaners & Detergents', price: 175, purchasePrice: 125, stock: 32, minStock: 8, unit: 'bottles', supplier: 'Lizol India', status: 'In Stock' },
      { id: 'hh4', name: 'Heavy Duty Scrub Sponges (Pack of 3)', category: 'Utility Essentials', price: 45, purchasePrice: 24, stock: 50, minStock: 15, unit: 'packs', supplier: 'Scotch Brite Agency', status: 'In Stock' },
      { id: 'hh5', name: 'Bio-Degradable Garbage Bags (Pack 30)', category: 'Paper & Plastic', price: 90, purchasePrice: 52, stock: 18, minStock: 10, unit: 'packs', supplier: 'EcoClean Pack', status: 'In Stock' },
      { id: 'hh6', name: 'Absorbent Kitchen Towel Rolls (2 Rolls)', category: 'Paper & Plastic', price: 130, purchasePrice: 88, stock: 6, minStock: 10, unit: 'packs', supplier: 'Origami Paper Co.', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'rhh1', type: 'urgent', productName: 'Lemon Dishwash Gel', message: 'Kitchen daily cleaner stock near zero.', recommendedOrder: 'Order 30 bottles' },
      { id: 'rhh2', type: 'warning', productName: 'Kitchen Towel Rolls', message: 'Household weekend shopping basket spike.', recommendedOrder: 'Order 20 packs' }
    ],
    recentSales: [
      { id: 'shh1', items: '1x Detergent, 1x Floor Cleaner', total: 390, time: '13 mins ago' },
      { id: 'shh2', items: '2x Scrub Sponges, 1x Garbage Bags', total: 180, time: '38 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Disinfectant Floor Cleaner', sold: '84 bottles', revenue: '₹14,700' },
      { rank: 2, name: 'Front Load Detergent', sold: '60 packs', revenue: '₹12,900' },
      { rank: 3, name: 'Heavy Duty Scrub Sponges', sold: '110 packs', revenue: '₹4,950' },
    ]
  },

  gardening: {
    products: [
      { id: 'gd1', name: 'Organic Potting Soil Mix (5kg)', category: 'Soil & Fertilizers', price: 250, purchasePrice: 160, stock: 22, minStock: 8, unit: 'bags', supplier: 'GreenEarth Organics', status: 'In Stock' },
      { id: 'gd2', name: 'Terracotta Plant Pots 10 Inch', category: 'Pots & Containers', price: 180, purchasePrice: 110, stock: 5, minStock: 10, unit: 'pots', supplier: 'Claycraft Pottery', status: 'Low Stock' },
      { id: 'gd3', name: 'Bio-Organic Vermicompost (2kg)', category: 'Soil & Fertilizers', price: 120, purchasePrice: 75, stock: 30, minStock: 10, unit: 'bags', supplier: 'EcoAgri Supplies', status: 'In Stock' },
      { id: 'gd4', name: 'Hybrid Vegetable Seeds Pack (5 Varieties)', category: 'Seeds & Bulbs', price: 150, purchasePrice: 85, stock: 40, minStock: 12, unit: 'packs', supplier: 'Indo-American Seeds', status: 'In Stock' },
      { id: 'gd5', name: 'Heavy Duty Gardening Gloves', category: 'Gardening Tools', price: 199, purchasePrice: 115, stock: 15, minStock: 5, unit: 'pairs', supplier: 'GardenPro Tools', status: 'In Stock' },
      { id: 'gd6', name: 'Pressure Water Plant Spray 2L', category: 'Gardening Tools', price: 340, purchasePrice: 220, stock: 4, minStock: 6, unit: 'units', supplier: 'GardenPro Tools', status: 'Low Stock' },
    ],
    recommendations: [
      { id: 'rgd1', type: 'urgent', productName: 'Terracotta Plant Pots', message: 'Weekend home gardener footfall expected.', recommendedOrder: 'Order 25 pots' },
      { id: 'rgd2', type: 'warning', productName: 'Pressure Water Spray', message: 'Low stock for garden maintenance equipment.', recommendedOrder: 'Order 12 units' }
    ],
    recentSales: [
      { id: 'sgd1', items: '1x Potting Soil, 1x Vermicompost', total: 370, time: '25 mins ago' },
      { id: 'sgd2', items: '2x Plant Pots, 1x Seeds Pack', total: 510, time: '55 mins ago' },
    ],
    topSelling: [
      { rank: 1, name: 'Organic Potting Soil Mix', sold: '55 bags', revenue: '₹13,750' },
      { rank: 2, name: 'Bio-Organic Vermicompost', sold: '70 bags', revenue: '₹8,400' },
      { rank: 3, name: 'Hybrid Seeds Pack', sold: '60 packs', revenue: '₹9,000' },
    ]
  },

  otherRetail: {
    products: [
      { id: 'or1', name: 'Retail Product A (Standard Pack)', category: 'Category A', price: 150, purchasePrice: 100, stock: 35, minStock: 10, unit: 'units', supplier: 'Primary Distributor', status: 'In Stock' },
      { id: 'or2', name: 'Retail Product B (Premium)', category: 'Category B', price: 450, purchasePrice: 320, stock: 7, minStock: 10, unit: 'units', supplier: 'Primary Distributor', status: 'Low Stock' },
      { id: 'or3', name: 'Retail Product C (Utility)', category: 'Category C', price: 85, purchasePrice: 55, stock: 50, minStock: 15, unit: 'units', supplier: 'Regional Supplier', status: 'In Stock' },
      { id: 'or4', name: 'Retail Product D (Special)', category: 'General Items', price: 299, purchasePrice: 195, stock: 12, minStock: 5, unit: 'units', supplier: 'Regional Supplier', status: 'In Stock' },
    ],
    recommendations: [
      { id: 'ror1', type: 'warning', productName: 'Retail Product B', message: 'Stock level is below threshold.', recommendedOrder: 'Order 20 units' }
    ],
    recentSales: [
      { id: 'sor1', items: '2x Product A, 1x Product C', total: 385, time: '15 mins ago' }
    ],
    topSelling: [
      { rank: 1, name: 'Retail Product A', sold: '90 units', revenue: '₹13,500' },
      { rank: 2, name: 'Retail Product C', sold: '120 units', revenue: '₹10,200' },
    ]
  }
};

export function getMockDataForBusiness(businessTypeId: BusinessTypeId): StoreMockData {
  return STORE_TEMPLATES[businessTypeId] || STORE_TEMPLATES.otherRetail;
}
