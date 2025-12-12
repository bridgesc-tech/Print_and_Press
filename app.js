// PWA Main JavaScript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, updateDoc, doc, query, where, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig, COLLECTIONS } from '../shared/firebase-config.js';
import { Order, OrderStatus } from '../shared/types.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// State
let currentPage = 'orders';
let orders = [];
let customers = [];
let itemCounter = 1;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    initializeNavigation();
    initializeEventListeners();
    setupRealtimeListeners();
    loadOrders();
    loadCustomers();
    
    // Set today's date as default for date inputs
    const dueDateInput = document.querySelector('input[name="dueDate"]');
    if (dueDateInput) dueDateInput.value = new Date().toISOString().split('T')[0];
    
    // Initialize first item's image upload
    setupImageUpload(1);
});

// Navigation
function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.getAttribute('data-page');
            switchPage(page);
        });
    });
}

function switchPage(page) {
    // Update nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const navBtn = document.querySelector(`[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Update pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(page);
    if (pageEl) pageEl.classList.add('active');

    currentPage = page;

    if (page === 'orders') {
        loadOrders();
    } else if (page === 'customers') {
        loadCustomers();
    }
}

// Make switchPage global for onclick handlers
window.switchPage = switchPage;

// Event Listeners
function initializeEventListeners() {
    // New Order Form
    document.getElementById('newOrderForm').addEventListener('submit', handleNewOrder);
    
    // Add Item Button
    document.getElementById('addItemBtn').addEventListener('click', addOrderItem);
    
    // Order Filter
    document.getElementById('orderFilter').addEventListener('change', loadOrders);
    
    // Customer Search
    const customerSearch = document.getElementById('customerSearchInput');
    if (customerSearch) {
        customerSearch.addEventListener('input', (e) => {
            loadCustomers(e.target.value);
        });
    }
    
    // New Customer Button
    const newCustomerBtn = document.getElementById('newCustomerBtn');
    if (newCustomerBtn) {
        newCustomerBtn.addEventListener('click', () => showCustomerModal());
    }
    
    // Modal close
    const closeModal = document.querySelector('.close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            document.getElementById('customerModal').style.display = 'none';
        });
    }
    
    // Close modal when clicking outside
    const modal = document.getElementById('customerModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
}

// Firebase Realtime Listeners
function setupRealtimeListeners() {
    const ordersQuery = query(
        collection(db, COLLECTIONS.ORDERS),
        orderBy('createdAt', 'desc')
    );
    
    onSnapshot(ordersQuery, (snapshot) => {
        orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (currentPage === 'orders') {
            loadOrders();
        }
        updateSyncIndicator(true);
    }, (error) => {
        console.error('Error listening to orders:', error);
        updateSyncIndicator(false);
    });
    
    const customersQuery = query(
        collection(db, COLLECTIONS.CUSTOMERS),
        orderBy('name', 'asc')
    );
    
    onSnapshot(customersQuery, (snapshot) => {
        customers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (currentPage === 'customers') {
            loadCustomers();
        }
    }, (error) => {
        console.error('Error listening to customers:', error);
    });
}

function updateSyncIndicator(synced) {
    const indicator = document.getElementById('syncIndicator');
    const dot = indicator.querySelector('.sync-dot');
    const text = indicator.querySelector('span:last-child');
    
    if (synced) {
        dot.style.background = '#4ade80';
        text.textContent = 'Synced';
    } else {
        dot.style.background = '#f59e0b';
        text.textContent = 'Syncing...';
    }
}

// Load Orders
function loadOrders() {
    const statusFilter = document.getElementById('orderFilter').value;
    let filteredOrders = orders;

    if (statusFilter !== 'all') {
        filteredOrders = orders.filter(o => o.status === statusFilter);
    }

    if (filteredOrders.length === 0) {
        document.getElementById('ordersList').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p>No orders found</p>
            </div>
        `;
        return;
    }

    const ordersHtml = filteredOrders.map(order => {
        const statusClass = `status-${order.status}`;
        const date = new Date(order.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        
        return `
            <div class="order-card">
                <div class="order-card-header">
                    <div class="order-customer">${order.customerName || 'Unknown Customer'}</div>
                    <span class="order-status ${statusClass}">${order.status.replace('_', ' ')}</span>
                </div>
                <div class="order-details">
                    ${order.customerPhone ? `<div>📞 ${order.customerPhone}</div>` : ''}
                    <div>📅 ${date}</div>
                    ${order.notes ? `<div>📝 ${order.notes.substring(0, 50)}${order.notes.length > 50 ? '...' : ''}</div>` : ''}
                </div>
                <div class="order-amount">$${order.totalAmount?.toFixed(2) || '0.00'}</div>
            </div>
        `;
    }).join('');

    document.getElementById('ordersList').innerHTML = ordersHtml;
}

// Handle New Order
async function handleNewOrder(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    // Collect items - match desktop structure
    const items = [];
    let itemIndex = 1;
    while (true) {
        const item = formData.get(`item${itemIndex}_item`);
        if (!item) break;
        
        const designImageData = document.getElementById(`designImageData_${itemIndex}`)?.value || '';
        
        items.push({
            item: item,
            color: formData.get(`item${itemIndex}_color`) || '',
            quantity: parseInt(formData.get(`item${itemIndex}_quantity`)) || 1,
            design: formData.get(`item${itemIndex}_design`) || '',
            designImage: designImageData || ''
        });
        itemIndex++;
    }
    
    if (items.length === 0) {
        alert('Please add at least one item to the order.');
        return;
    }

    const totalAmount = parseFloat(formData.get('totalAmount')) || 0;

    const orderData = {
        customerName: formData.get('customerName'),
        customerPhone: formData.get('customerPhone') || '',
        customerEmail: formData.get('customerEmail') || '',
        items: items,
        totalAmount: totalAmount,
        status: OrderStatus.PENDING,
        notes: formData.get('notes') || '',
        dueDate: formData.get('dueDate') || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    try {
        await addDoc(collection(db, COLLECTIONS.ORDERS), orderData);
        
        // Reset form
        e.target.reset();
        itemCounter = 1;
        document.getElementById('orderItems').innerHTML = createOrderItemHTML(1);
        document.getElementById('totalAmountInput').value = '0.00';
        setupImageUpload(1);
        
        // Show success and switch to orders page
        alert('Order created successfully!');
        switchPage('orders');
    } catch (error) {
        console.error('Error creating order:', error);
        alert('Error creating order. Please try again.');
    }
}

// Create Order Item HTML
function createOrderItemHTML(itemNum, itemData = {}) {
    return `
        <div class="order-item" data-item-num="${itemNum}">
            <div class="form-group">
                <label>Item *</label>
                <input type="text" name="item${itemNum}_item" value="${itemData.item || ''}" required placeholder="e.g., T-shirt, Hoodie">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Color</label>
                    <input type="text" name="item${itemNum}_color" value="${itemData.color || ''}" placeholder="e.g., Black, White">
                </div>
                <div class="form-group">
                    <label>Quantity *</label>
                    <input type="number" name="item${itemNum}_quantity" value="${itemData.quantity || 1}" min="1" required>
                </div>
            </div>
            <div class="form-group">
                <label>Design</label>
                <input type="text" name="item${itemNum}_design" value="${itemData.design || ''}" placeholder="Design name or description">
            </div>
            <div class="form-group">
                <label>Design Image</label>
                <div class="image-upload-container">
                    <input type="file" name="item${itemNum}_designImage" accept="image/*" class="image-upload-input" data-item-num="${itemNum}" style="display: none;">
                    <button type="button" class="btn-image-upload" data-item-num="${itemNum}">
                        📷 Upload Image
                    </button>
                    <div class="image-preview" id="preview_${itemNum}" style="display: ${itemData.designImage ? 'flex' : 'none'};">
                        ${itemData.designImage ? `<img id="preview_img_${itemNum}" src="${itemData.designImage}" alt="Design preview" style="max-width: 100px; max-height: 100px; border-radius: 4px; margin-top: 0.5rem;">` : ''}
                        <button type="button" class="btn-remove-image" data-item-num="${itemNum}" style="margin-left: 0.5rem; background: #dc3545; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Remove</button>
                    </div>
                </div>
                <input type="hidden" name="item${itemNum}_designImageData" id="designImageData_${itemNum}" value="${itemData.designImage || ''}">
            </div>
            <button type="button" class="btn btn-secondary" onclick="removeOrderItem(${itemNum})" style="margin-top: 0.5rem;">Remove Item</button>
        </div>
    `;
}

// Setup Image Upload Handler
function setupImageUpload(itemNum) {
    const fileInput = document.querySelector(`input[name="item${itemNum}_designImage"]`);
    const uploadBtn = document.querySelector(`.btn-image-upload[data-item-num="${itemNum}"]`);
    const removeBtn = document.querySelector(`.btn-remove-image[data-item-num="${itemNum}"]`);
    
    if (uploadBtn) {
        uploadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (fileInput) fileInput.click();
        });
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const base64Image = event.target.result;
                    const previewDiv = document.getElementById(`preview_${itemNum}`);
                    const previewImg = document.getElementById(`preview_img_${itemNum}`);
                    const hiddenInput = document.getElementById(`designImageData_${itemNum}`);
                    
                    if (previewDiv && hiddenInput) {
                        if (!previewImg) {
                            const img = document.createElement('img');
                            img.id = `preview_img_${itemNum}`;
                            img.src = base64Image;
                            img.alt = 'Design preview';
                            img.style.cssText = 'max-width: 100px; max-height: 100px; border-radius: 4px; margin-top: 0.5rem;';
                            previewDiv.insertBefore(img, previewDiv.firstChild);
                        } else {
                            previewImg.src = base64Image;
                        }
                        previewDiv.style.display = 'flex';
                        hiddenInput.value = base64Image;
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            removeDesignImage(itemNum);
        });
    }
}

// Remove Design Image
function removeDesignImage(itemNum) {
    const previewDiv = document.getElementById(`preview_${itemNum}`);
    const hiddenInput = document.getElementById(`designImageData_${itemNum}`);
    const fileInput = document.querySelector(`input[name="item${itemNum}_designImage"]`);
    
    if (previewDiv) {
        previewDiv.style.display = 'none';
        const img = previewDiv.querySelector('img');
        if (img) img.remove();
    }
    if (hiddenInput) hiddenInput.value = '';
    if (fileInput) fileInput.value = '';
}

// Make functions global
window.removeDesignImage = removeDesignImage;
window.removeOrderItem = (itemNum) => {
    const item = document.querySelector(`.order-item[data-item-num="${itemNum}"]`);
    if (item) item.remove();
};

// Add Order Item
function addOrderItem() {
    itemCounter++;
    const orderItems = document.getElementById('orderItems');
    const newItemHTML = createOrderItemHTML(itemCounter);
    orderItems.insertAdjacentHTML('beforeend', newItemHTML);
    setupImageUpload(itemCounter);
}

// Load Customers
function loadCustomers(searchQuery = '') {
    let filteredCustomers = customers;
    
    if (searchQuery && searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filteredCustomers = customers.filter(c => 
            (c.name && c.name.toLowerCase().includes(query)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.email && c.email.toLowerCase().includes(query))
        );
    }
    
    const customersList = document.getElementById('customersList');
    if (!customersList) return;
    
    if (filteredCustomers.length === 0) {
        customersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>No customers found</p>
            </div>
        `;
        return;
    }
    
    const customersHtml = filteredCustomers.map(customer => `
        <div class="customer-card">
            <div class="customer-name">${customer.name || 'Unknown'}</div>
            <div class="customer-contact">
                ${customer.phone ? `<div>📞 ${customer.phone}</div>` : ''}
                ${customer.email ? `<div>✉️ ${customer.email}</div>` : ''}
                ${customer.address ? `<div>📍 ${customer.address}</div>` : ''}
            </div>
        </div>
    `).join('');
    
    customersList.innerHTML = customersHtml;
}

// Show Customer Modal
function showCustomerModal(customer = null) {
    const isEdit = !!customer;
    const modal = document.getElementById('customerModal');
    const modalBody = document.getElementById('customerModalBody');
    
    if (!modal || !modalBody) return;
    
    modalBody.innerHTML = `
        <h2>${isEdit ? 'Edit' : 'Add'} Customer</h2>
        <form id="customerForm" class="order-form" style="box-shadow: none; padding: 0;">
            <div class="form-group">
                <label>Name *</label>
                <input type="text" name="name" value="${customer?.name || ''}" required>
            </div>
            <div class="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" value="${customer?.phone || ''}" placeholder="(555) 123-4567">
            </div>
            <div class="form-group">
                <label>Email</label>
                <input type="email" name="email" value="${customer?.email || ''}" placeholder="customer@example.com">
            </div>
            <div class="form-group">
                <label>Address</label>
                <textarea name="address" rows="2" placeholder="Street address">${customer?.address || ''}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="document.getElementById('customerModal').style.display='none';">Cancel</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Add'} Customer</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
    
    // Handle form submission
    const form = document.getElementById('customerForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleCustomerSubmit(e, customer);
        });
    }
}

// Handle Customer Form Submit
async function handleCustomerSubmit(e, customer = null) {
    const formData = new FormData(e.target);
    
    const customerData = {
        name: formData.get('name'),
        phone: formData.get('phone') || '',
        email: formData.get('email') || '',
        address: formData.get('address') || ''
    };
    
    try {
        if (customer) {
            await updateDoc(doc(db, COLLECTIONS.CUSTOMERS, customer.id), customerData);
        } else {
            customerData.createdAt = new Date().toISOString();
            await addDoc(collection(db, COLLECTIONS.CUSTOMERS), customerData);
        }
        
        document.getElementById('customerModal').style.display = 'none';
        loadCustomers();
    } catch (error) {
        console.error('Error saving customer:', error);
        alert('Error saving customer. Please try again.');
    }
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    });
}

