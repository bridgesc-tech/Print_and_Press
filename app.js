// PWA Main JavaScript
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, updateDoc, doc, query, where, onSnapshot, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { firebaseConfig, COLLECTIONS } from './firebase-config.js';
import { Order, OrderStatus } from './types.js';

// Initialize Firebase
let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

// State
let currentPage = 'orders';
let orders = [];
let customers = [];
let itemCounter = 1;
let editingOrderId = null;

// Debug message display (shows on-screen messages for mobile debugging)
function showDebugMessage(message, type = 'info') {
    // Only show errors and important messages to avoid clutter
    if (type === 'info' && !message.includes('error') && !message.includes('Error')) {
        console.log(message);
        return; // Don't show info messages on screen, just log them
    }
    
    // Remove existing debug message
    const existing = document.getElementById('debugMessage');
    if (existing) existing.remove();
    
    const debugMsg = document.createElement('div');
    debugMsg.id = 'debugMessage';
    debugMsg.style.cssText = `
        position: fixed;
        top: 120px;
        left: 1rem;
        right: 1rem;
        background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#667eea'};
        color: white;
        padding: 0.75rem;
        border-radius: 8px;
        z-index: 10000;
        font-size: 0.85rem;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        text-align: center;
    `;
    debugMsg.textContent = message;
    document.body.appendChild(debugMsg);
    
    console.log('[DEBUG]', message);
    
    // Auto-remove after 5 seconds (or 10 seconds for errors)
    setTimeout(() => {
        if (debugMsg.parentNode) {
            debugMsg.remove();
        }
    }, type === 'error' ? 10000 : 5000);
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    console.log('PWA Initializing...');
    window.appStartTime = Date.now(); // Track when app started
    
    // Check if Firebase is initialized
    if (!db || !auth) {
        showDebugMessage('ERROR: Firebase not initialized! Check firebase-config.js', 'error');
        updateSyncIndicator(false);
        return;
    }
    
    // Initialize sync indicator to "Syncing..." initially
    updateSyncIndicator(false);
    
    // Authenticate with anonymous auth (required for Firestore access)
    // CRITICAL: Wait for authentication to complete before proceeding
    let authenticated = false;
    try {
        showDebugMessage('Authenticating with Firebase...', 'info');
        const userCredential = await signInAnonymously(auth);
        window.firebaseAuthenticated = true;
        authenticated = true;
        console.log('Anonymous authentication successful');
    } catch (authError) {
        console.error('Authentication error:', authError);
        // If anonymous auth fails, check for existing auth state
        const currentUser = auth.currentUser;
        if (currentUser) {
            window.firebaseAuthenticated = true;
            authenticated = true;
            console.log('Using existing auth state');
        } else {
            // Wait a moment and retry once
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const retryCredential = await signInAnonymously(auth);
                window.firebaseAuthenticated = true;
                authenticated = true;
                console.log('Anonymous authentication successful on retry');
            } catch (retryError) {
                showDebugMessage('Auth failed: ' + (retryError.message || retryError.code), 'error');
                updateSyncIndicator(false);
                return;
            }
        }
    }
    
    // Ensure authentication is complete before proceeding
    // Verify auth state is actually set
    const finalAuthCheck = auth.currentUser;
    if (!finalAuthCheck) {
        // Wait a moment and check again (auth might be propagating)
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryAuthCheck = auth.currentUser;
        if (!retryAuthCheck) {
            showDebugMessage('Auth did not complete. Check Firebase settings.', 'error');
            updateSyncIndicator(false);
            return;
        }
    }
    
    if (!authenticated || !window.firebaseAuthenticated) {
        window.firebaseAuthenticated = true; // Set it now since we verified auth.currentUser exists
    }
    
    console.log('Firebase authentication verified, current user:', auth.currentUser?.uid);
    
    // Wait for auth state to be confirmed via listener
    await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                console.log('Auth state confirmed, user ID:', user.uid);
                unsubscribe();
                resolve();
            }
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
            unsubscribe();
            resolve();
        }, 5000);
    });
    
    // Additional wait to ensure auth token is propagated to Firestore
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Final verification
    if (!auth.currentUser) {
        showDebugMessage('ERROR: Authentication failed. User not found.', 'error');
        updateSyncIndicator(false);
        return;
    }
    
    console.log('Final auth check - User ID:', auth.currentUser.uid);
    showDebugMessage('Authenticated! User: ' + auth.currentUser.uid.substring(0, 8) + '...', 'success');
    
    initializeNavigation();
    initializeEventListeners();
    setupRealtimeListeners();
    
    // Load initial data after a short delay to ensure Firebase is ready
    setTimeout(() => {
        loadOrders();
        loadCustomers();
    }, 500);
    
    // Set today's date as default for date inputs
    const dueDateInput = document.querySelector('input[name="dueDate"]');
    if (dueDateInput) dueDateInput.value = new Date().toISOString().split('T')[0];
    
    // Initialize first item's image upload
    setupImageUpload(1);
    
    console.log('PWA Initialized');
});

// Navigation
function initializeNavigation() {
    // Use event delegation on the nav container for better reliability
    const topNav = document.querySelector('.top-nav');
    if (topNav) {
        topNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.nav-btn');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const page = btn.getAttribute('data-page');
                if (page) {
                    console.log('Navigating to page:', page);
                    switchPage(page);
                }
            }
        });
    }
    
    // Also set up individual buttons as backup
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.style.pointerEvents = 'auto';
        btn.style.cursor = 'pointer';
        
        // Remove any existing listeners by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        // Add click handler
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const page = newBtn.getAttribute('data-page');
            console.log('Button clicked, page:', page);
            if (page) {
                switchPage(page);
            }
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
    } else if (page === 'new-order') {
        // Reset form if not editing
        if (!editingOrderId) {
            const pageHeader = document.querySelector('#new-order .page-header h2');
            if (pageHeader) {
                pageHeader.textContent = 'New Order';
            }
            const submitBtn = document.getElementById('submitOrderBtn');
            if (submitBtn) {
                submitBtn.textContent = 'Create Order';
            }
        }
        // Setup autocomplete
        setupCustomerAutocomplete();
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
let ordersListenerActive = false;
let customersListenerActive = false;

function setupRealtimeListeners() {
    if (!db) {
        showDebugMessage('ERROR: Database not available!', 'error');
        return;
    }
    
    // Verify authentication before accessing Firestore
    if (!auth || !auth.currentUser) {
        showDebugMessage('ERROR: Not authenticated! Cannot access Firestore.', 'error');
        updateSyncIndicator(false);
        return;
    }
    
    console.log('Setting up Firebase listeners...');
    console.log('Collections:', COLLECTIONS);
    console.log('Database:', db);
    console.log('Authenticated user:', auth.currentUser.uid);
    
    // Use simple collection listeners (more reliable, works without indexes)
    setupSimpleOrdersListener();
    setupSimpleCustomersListener();
    
    // Set multiple timeouts to check connection status
    setTimeout(() => {
        checkSyncStatus();
    }, 2000);
    
    setTimeout(() => {
        checkSyncStatus();
    }, 5000);
    
    setTimeout(() => {
        checkSyncStatus();
    }, 10000);
}

function checkSyncStatus() {
    if (ordersListenerActive || customersListenerActive) {
        // At least one listener is working - mark as synced
        console.log('At least one listener active, marking as synced');
        updateSyncIndicator(true);
        if (ordersListenerActive && customersListenerActive) {
            console.log('Both listeners active');
        } else {
            console.log('Partial connection - orders:', ordersListenerActive, 'customers:', customersListenerActive);
        }
    } else {
        // Neither listener is working - but don't show error immediately, might still be connecting
        console.log('Listeners not active yet - orders:', ordersListenerActive, 'customers:', customersListenerActive);
        // Only show error after 10 seconds
        if (Date.now() - window.appStartTime > 10000) {
            showDebugMessage('ERROR: Cannot connect to Firebase. Check internet and Firebase config.', 'error');
            updateSyncIndicator(false);
        }
    }
}

// Simple collection listeners without orderBy (more reliable)
function setupSimpleOrdersListener() {
    console.log('Setting up orders listener for collection:', COLLECTIONS.ORDERS);
    
    const ordersRef = collection(db, COLLECTIONS.ORDERS);
    
    onSnapshot(ordersRef, (snapshot) => {
        console.log('Orders snapshot received, docs:', snapshot.docs.length);
        ordersListenerActive = true;
        
        orders = snapshot.docs.map(doc => {
            const data = doc.data();
            console.log('Order data:', { id: doc.id, customerName: data.customerName, status: data.status });
            return { id: doc.id, ...data };
        });
        
        // Sort by createdAt if available, otherwise by id
        orders.sort((a, b) => {
            const aDate = a.createdAt || a.updatedAt || '';
            const bDate = b.createdAt || b.updatedAt || '';
            return bDate.localeCompare(aDate);
        });
        
        console.log('Total orders loaded:', orders.length);
        
        if (currentPage === 'orders') {
            loadOrders();
        }
        
        // Update sync indicator immediately when listener connects
        updateSyncIndicator(true);
        console.log('Orders listener connected - sync indicator updated to Synced');
        
        if (orders.length > 0) {
            showDebugMessage(`Orders loaded: ${orders.length}`, 'success');
        } else {
            console.log('Orders collection is empty but connected');
        }
    }, (error) => {
        console.error('Error listening to orders:', error);
        console.error('Error details:', error.code, error.message);
        ordersListenerActive = false;
        
        // Show specific error messages
        if (error.code === 'permission-denied') {
            const authStatus = auth?.currentUser ? 'Authenticated as: ' + auth.currentUser.uid.substring(0, 8) : 'Not authenticated';
            showDebugMessage('Orders: Permission denied. Auth: ' + authStatus, 'error');
            console.error('Permission denied - Auth state:', {
                hasAuth: !!auth,
                currentUser: auth?.currentUser?.uid,
                errorCode: error.code,
                errorMessage: error.message
            });
        } else {
            showDebugMessage(`Orders error: ${error.code || error.message}`, 'error');
        }
        
        // Only update sync indicator if customers also failed
        if (!customersListenerActive) {
            updateSyncIndicator(false);
        }
    });
}

function setupSimpleCustomersListener() {
    console.log('Setting up customers listener for collection:', COLLECTIONS.CUSTOMERS);
    
    const customersRef = collection(db, COLLECTIONS.CUSTOMERS);
    
    onSnapshot(customersRef, (snapshot) => {
        console.log('Customers snapshot received, docs:', snapshot.docs.length);
        customersListenerActive = true;
        
        customers = snapshot.docs.map(doc => {
            const data = doc.data();
            console.log('Customer data:', { id: doc.id, name: data.name });
            return { id: doc.id, ...data };
        });
        
        // Sort by name if available
        customers.sort((a, b) => {
            const aName = (a.name || '').toLowerCase();
            const bName = (b.name || '').toLowerCase();
            return aName.localeCompare(bName);
        });
        
        console.log('Total customers loaded:', customers.length);
        
        if (currentPage === 'customers') {
            loadCustomers();
        }
        
        // Update sync indicator immediately when listener connects
        updateSyncIndicator(true);
        console.log('Customers listener connected - sync indicator updated to Synced');
        
        if (customers.length > 0) {
            showDebugMessage(`Customers loaded: ${customers.length}`, 'success');
        } else {
            console.log('Customers collection is empty but connected');
        }
    }, (error) => {
        console.error('Error listening to customers:', error);
        console.error('Error details:', error.code, error.message);
        customersListenerActive = false;
        
        // Show specific error messages
        if (error.code === 'permission-denied') {
            const authStatus = auth?.currentUser ? 'Authenticated as: ' + auth.currentUser.uid.substring(0, 8) : 'Not authenticated';
            showDebugMessage('Customers: Permission denied. Auth: ' + authStatus, 'error');
            console.error('Permission denied - Auth state:', {
                hasAuth: !!auth,
                currentUser: auth?.currentUser?.uid,
                errorCode: error.code,
                errorMessage: error.message
            });
        } else {
            showDebugMessage(`Customers error: ${error.code || error.message}`, 'error');
        }
        
        // Only update sync indicator if orders also failed
        if (!ordersListenerActive) {
            updateSyncIndicator(false);
        }
    });
}

function updateSyncIndicator(synced) {
    const indicator = document.getElementById('syncIndicator');
    if (!indicator) {
        console.warn('Sync indicator element not found');
        return;
    }
    
    const dot = indicator.querySelector('.sync-dot');
    const textSpans = indicator.querySelectorAll('span');
    // Get the text span (should be the second span, after the dot)
    const text = Array.from(textSpans).find(span => !span.classList.contains('sync-dot')) || textSpans[textSpans.length - 1];
    
    if (!dot) {
        console.warn('Sync dot not found');
        return;
    }
    
    if (synced) {
        dot.style.background = '#4ade80';
        if (text) text.textContent = 'Synced';
        console.log('Sync indicator: Synced');
    } else {
        dot.style.background = '#f59e0b';
        if (text) text.textContent = 'Syncing...';
        console.log('Sync indicator: Syncing...');
    }
}

// Load Orders
function loadOrders() {
    const ordersListEl = document.getElementById('ordersList');
    if (!ordersListEl) {
        console.warn('Orders list element not found');
        return;
    }
    
    console.log('Loading orders, total:', orders.length);
    const statusFilter = document.getElementById('orderFilter')?.value || 'all';
    let filteredOrders = orders;

    if (statusFilter !== 'all') {
        filteredOrders = orders.filter(o => o.status === statusFilter);
    }

    console.log('Filtered orders:', filteredOrders.length);

    if (filteredOrders.length === 0) {
        ordersListEl.innerHTML = `
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
            <div class="order-card" onclick="editOrder('${order.id}')">
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

    ordersListEl.innerHTML = ordersHtml;
    console.log('Orders displayed:', filteredOrders.length);
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
    const status = formData.get('status') || OrderStatus.PENDING;

    const orderData = {
        customerName: formData.get('customerName'),
        customerPhone: formData.get('customerPhone') || '',
        customerEmail: formData.get('customerEmail') || '',
        items: items,
        totalAmount: totalAmount,
        status: status,
        notes: formData.get('notes') || '',
        dueDate: formData.get('dueDate') || null,
        updatedAt: new Date().toISOString()
    };

    try {
        if (editingOrderId) {
            // Update existing order
            const orderRef = doc(db, COLLECTIONS.ORDERS, editingOrderId);
            await updateDoc(orderRef, orderData);
            alert('Order updated successfully!');
            editingOrderId = null;
        } else {
            // Create new order
            orderData.createdAt = new Date().toISOString();
            await addDoc(collection(db, COLLECTIONS.ORDERS), orderData);
            alert('Order created successfully!');
        }
        
        // Reset form
        e.target.reset();
        itemCounter = 1;
        editingOrderId = null;
        document.getElementById('orderItems').innerHTML = createOrderItemHTML(1);
        document.getElementById('totalAmountInput').value = '0.00';
        document.getElementById('customerIdInput').value = '';
        const pageHeader = document.querySelector('#new-order .page-header h2');
        if (pageHeader) {
            pageHeader.textContent = 'New Order';
        }
        const submitBtn = document.getElementById('submitOrderBtn');
        if (submitBtn) {
            submitBtn.textContent = 'Create Order';
        }
        setupImageUpload(1);
        setupCustomerAutocomplete();
        
        // Show success and switch to orders page
        switchPage('orders');
    } catch (error) {
        console.error('Error saving order:', error);
        alert('Error saving order. Please try again.');
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

// Edit Order
function editOrder(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        alert('Order not found');
        return;
    }
    
    editingOrderId = orderId;
    
    // Update page header
    const pageHeader = document.querySelector('#new-order .page-header h2');
    if (pageHeader) {
        pageHeader.textContent = `Edit Order${order.orderNumber ? ` #${order.orderNumber}` : ''}`;
    }
    
    // Update submit button
    const submitBtn = document.getElementById('submitOrderBtn');
    if (submitBtn) {
        submitBtn.textContent = 'Update Order';
    }
    
    // Populate form
    const form = document.getElementById('newOrderForm');
    if (form) {
        form.querySelector('[name="customerName"]').value = order.customerName || '';
        form.querySelector('[name="customerPhone"]').value = order.customerPhone || '';
        form.querySelector('[name="customerEmail"]').value = order.customerEmail || '';
        form.querySelector('[name="totalAmount"]').value = order.totalAmount || '0.00';
        form.querySelector('[name="notes"]').value = order.notes || '';
        form.querySelector('[name="dueDate"]').value = order.dueDate ? order.dueDate.split('T')[0] : '';
        form.querySelector('[name="status"]').value = order.status || 'pending';
        
        // Set customer ID if available
        if (order.customerId) {
            document.getElementById('customerIdInput').value = order.customerId;
        }
        
        // Populate items
        const orderItems = document.getElementById('orderItems');
        if (orderItems && order.items && order.items.length > 0) {
            itemCounter = 0;
            orderItems.innerHTML = '';
            order.items.forEach((item, index) => {
                itemCounter = index + 1;
                const itemHTML = createOrderItemHTML(itemCounter, item);
                orderItems.insertAdjacentHTML('beforeend', itemHTML);
                setupImageUpload(itemCounter);
            });
        } else {
            itemCounter = 1;
            orderItems.innerHTML = createOrderItemHTML(1);
            setupImageUpload(1);
        }
    }
    
    // Switch to new-order page
    switchPage('new-order');
    
    // Setup autocomplete
    setupCustomerAutocomplete();
}

// Setup Customer Autocomplete
function setupCustomerAutocomplete() {
    const customerNameInput = document.getElementById('customerNameInput');
    const customerPhoneInput = document.querySelector('input[name="customerPhone"]');
    const customerEmailInput = document.querySelector('input[name="customerEmail"]');
    const autocompleteDropdown = document.getElementById('customerAutocomplete');
    
    if (!customerNameInput || !autocompleteDropdown) {
        return;
    }
    
    // Only setup autocomplete for new orders (not when editing)
    if (editingOrderId) {
        return;
    }
    
    let selectedIndex = -1;
    let filteredCustomers = [];
    
    // Remove existing listeners by cloning
    const newInput = customerNameInput.cloneNode(true);
    customerNameInput.parentNode.replaceChild(newInput, customerNameInput);
    
    const getCustomers = () => {
        if (customers && Array.isArray(customers) && customers.length > 0) {
            return customers;
        }
        return [];
    };
    
    newInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        
        // Clear customerId when user manually types
        const customerIdInput = document.getElementById('customerIdInput');
        if (customerIdInput && !e.target.dataset.autocompleteSelecting) {
            customerIdInput.value = '';
        }
        
        if (query.length < 1) {
            autocompleteDropdown.style.display = 'none';
            return;
        }
        
        const customersList = getCustomers();
        
        if (customersList.length === 0) {
            autocompleteDropdown.style.display = 'none';
            return;
        }
        
        // Filter customers by name
        filteredCustomers = customersList.filter(c => 
            c && c.name && typeof c.name === 'string' && c.name.toLowerCase().includes(query)
        ).slice(0, 5);
        
        if (filteredCustomers.length > 0) {
            autocompleteDropdown.innerHTML = filteredCustomers.map((customer, index) => `
                <div class="autocomplete-item" data-index="${index}" data-customer-id="${customer.id}">
                    <strong>${customer.name}</strong>
                    ${customer.phone ? `<span style="color: #666; font-size: 0.85rem;"> • ${customer.phone}</span>` : ''}
                    ${customer.email ? `<span style="color: #666; font-size: 0.85rem;"> • ${customer.email}</span>` : ''}
                </div>
            `).join('');
            autocompleteDropdown.style.display = 'block';
            selectedIndex = -1;
        } else {
            autocompleteDropdown.style.display = 'none';
        }
    });
    
    newInput.addEventListener('keydown', (e) => {
        if (autocompleteDropdown.style.display === 'none') return;
        
        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            items.forEach((item, idx) => {
                item.classList.toggle('selected', idx === selectedIndex);
            });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            items.forEach((item, idx) => {
                item.classList.toggle('selected', idx === selectedIndex);
            });
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            const selectedItem = items[selectedIndex];
            selectCustomer(selectedItem, newInput, customerPhoneInput, customerEmailInput, autocompleteDropdown);
        } else if (e.key === 'Escape') {
            autocompleteDropdown.style.display = 'none';
        }
    });
    
    // Handle clicks on autocomplete items
    autocompleteDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (item) {
            selectCustomer(item, newInput, customerPhoneInput, customerEmailInput, autocompleteDropdown);
        }
    });
    
    function selectCustomer(item, nameInput, phoneInput, emailInput, dropdown) {
        const customerId = item.getAttribute('data-customer-id');
        const customer = customers.find(c => c && c.id === customerId);
        
        if (customer) {
            nameInput.dataset.autocompleteSelecting = 'true';
            nameInput.value = customer.name;
            if (phoneInput) phoneInput.value = customer.phone || '';
            if (emailInput) emailInput.value = customer.email || '';
            const customerIdInput = document.getElementById('customerIdInput');
            if (customerIdInput) customerIdInput.value = customerId;
            dropdown.style.display = 'none';
            setTimeout(() => {
                delete nameInput.dataset.autocompleteSelecting;
            }, 100);
        }
    }
    
    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!newInput.contains(e.target) && !autocompleteDropdown.contains(e.target)) {
            autocompleteDropdown.style.display = 'none';
        }
    });
}

// Make functions global
window.editOrder = editOrder;
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
    const customersList = document.getElementById('customersList');
    if (!customersList) {
        console.warn('Customers list element not found');
        return;
    }
    
    console.log('Loading customers, total:', customers.length);
    let filteredCustomers = customers;
    
    if (searchQuery && searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        filteredCustomers = customers.filter(c => 
            (c.name && c.name.toLowerCase().includes(query)) ||
            (c.phone && c.phone.includes(query)) ||
            (c.email && c.email.toLowerCase().includes(query))
        );
    }
    
    console.log('Filtered customers:', filteredCustomers.length);
    
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

// Update Manager Class (matching Hunting Red app approach)
class UpdateManager {
    constructor() {
        this.registration = null;
        this.updateAvailable = false;
        this.checkingForUpdate = false;
        this.setupUI();
    }
    
    setupUI() {
        // Create update notification banner
        const updateBanner = document.createElement('div');
        updateBanner.id = 'updateBanner';
        updateBanner.className = 'update-banner hidden';
        updateBanner.innerHTML = `
            <div class="update-banner-content">
                <span class="update-banner-text">🔄 New version available! Click to update.</span>
                <div class="update-banner-actions">
                    <button id="updateNowBtn" class="btn btn-primary" style="padding: 6px 12px; font-size: 13px; margin-right: 8px;">Update Now</button>
                    <button id="updateLaterBtn" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">Later</button>
                </div>
            </div>
        `;
        document.body.insertBefore(updateBanner, document.body.firstChild);
        
        // Setup update banner buttons (use event delegation since elements are created dynamically)
        document.body.addEventListener('click', (e) => {
            if (e.target.id === 'updateNowBtn') {
                this.applyUpdate();
            } else if (e.target.id === 'updateLaterBtn') {
                this.hideUpdateBanner();
            }
        });
    }
    
    async registerServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            console.log('Service Workers not supported');
            return;
        }
        
        try {
            this.registration = await navigator.serviceWorker.register('/Print_and_Press/service-worker.js', { scope: '/Print_and_Press/' });
            console.log('Service Worker registered:', this.registration);
            
            // Check for updates immediately
            await this.checkForUpdate();
            
            // Listen for service worker updates
            this.registration.addEventListener('updatefound', () => {
                console.log('Service Worker update found');
                this.handleUpdateFound();
            });
            
            // Check for updates periodically (every 5 minutes)
            setInterval(() => this.checkForUpdate(), 5 * 60 * 1000);
            
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
    
    async checkForUpdate() {
        if (this.checkingForUpdate || !this.registration) return;
        
        this.checkingForUpdate = true;
        
        try {
            // Force update check
            await this.registration.update();
            
            // Check if there's a waiting service worker
            if (this.registration.waiting) {
                this.updateAvailable = true;
                this.showUpdateBanner();
            } else {
                // Check if there's an installing service worker
                if (this.registration.installing) {
                    this.handleUpdateFound();
                } else {
                    console.log('No updates available');
                }
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
        } finally {
            this.checkingForUpdate = false;
        }
    }
    
    handleUpdateFound() {
        const installingWorker = this.registration.installing;
        if (!installingWorker) return;
        
        installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                    // New service worker is waiting
                    this.updateAvailable = true;
                    this.showUpdateBanner();
                } else {
                    // First time install
                    console.log('Service Worker installed for the first time');
                }
            }
        });
    }
    
    showUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.remove('hidden');
        }
    }
    
    hideUpdateBanner() {
        const banner = document.getElementById('updateBanner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }
    
    async applyUpdate() {
        try {
            // Clear all caches first to ensure fresh files are loaded
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cacheName => {
                    return caches.delete(cacheName);
                })
            );
            
            // Unregister all service workers
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(
                registrations.map(registration => {
                    console.log('Unregistering service worker');
                    return registration.unregister();
                })
            );
            
            // Force reload with cache bypass (use timestamp to bust cache)
            window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
        } catch (error) {
            console.error('Error applying update:', error);
            // Fallback: reload with cache bypass
            window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
        }
    }
}

// Initialize Update Manager
let updateManager = null;
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        updateManager = new UpdateManager();
        updateManager.registerServiceWorker();
    });
}

// Check for updates on app focus
window.addEventListener('focus', () => {
    if (updateManager) {
        updateManager.checkForUpdate();
    }
});

// Also check when coming back online
window.addEventListener('online', () => {
    if (updateManager) {
        updateManager.checkForUpdate();
    }
});

