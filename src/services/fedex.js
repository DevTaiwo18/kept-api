const axios = require('axios');

const FEDEX_API_KEY = process.env.FEDEX_API_KEY;
const FEDEX_SECRET = process.env.FEDEX_SECRET;
const FEDEX_ACCOUNT = process.env.FEDEX_ACCOUNT;
const FEDEX_BASE_URL = process.env.FEDEX_BASE_URL || 'https://apis-sandbox.fedex.com';

async function getFedExToken() {
  try {
    const response = await axios.post(
      `${FEDEX_BASE_URL}/oauth/token`, 
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: FEDEX_API_KEY,
        client_secret: FEDEX_SECRET
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('FedEx auth error:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with FedEx');
  }
}

function formatPhoneNumber(phone) {
  if (!phone) return '5135551234';
  
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return cleaned;
  }
  
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1);
  }
  
  return '5135551234';
}

exports.calculateShipping = async ({ originAddress, destinationAddress, items }) => {
  try {
    const token = await getFedExToken();
    
    const totalWeight = Math.max(items.length * 5, 1);

    const requestBody = {
      requestedShipment: {
        shipper: {
          address: {
            streetLines: [originAddress.address],
            city: originAddress.city,
            stateOrProvinceCode: originAddress.state,
            postalCode: originAddress.zipCode,
            countryCode: 'US'
          }
        },
        recipient: {
          address: {
            streetLines: [destinationAddress.address],
            city: destinationAddress.city,
            stateOrProvinceCode: destinationAddress.state,
            postalCode: destinationAddress.zipCode,
            countryCode: 'US'
          }
        },
        pickupType: FEDEX_ACCOUNT ? 'USE_SCHEDULED_PICKUP' : 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: FEDEX_ACCOUNT ? ['ACCOUNT', 'LIST'] : ['LIST'],
        requestedPackageLineItems: [{
          weight: {
            units: 'LB',
            value: totalWeight
          }
        }]
      }
    };

    if (FEDEX_ACCOUNT) {
      requestBody.accountNumber = { value: FEDEX_ACCOUNT };
    }

    const response = await axios.post(
      `${FEDEX_BASE_URL}/rate/v1/rates/quotes`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const rates = response.data.output.rateReplyDetails || [];
    
    const groundService = rates.find(r => 
      r.serviceType.includes('GROUND') || r.serviceType.includes('HOME_DELIVERY')
    );

    if (!groundService) {
      throw new Error('No shipping rates available');
    }

    const rateDetail = groundService.ratedShipmentDetails[0];
    const rate = parseFloat(rateDetail.totalNetCharge) || 0;

    return {
      carrier: 'FedEx',
      service: groundService.serviceName,
      rate,
      estimatedDays: groundService.commit?.dateDetail?.dayOfWeek ? 
        calculateBusinessDays(groundService.commit.dateDetail.dayOfWeek) : 5
    };

  } catch (error) {
    console.error('FedEx rate calculation error:', error.response?.data || error.message);
    
    return {
      carrier: 'FedEx',
      service: 'Ground (Estimated)',
      rate: 25.00,
      estimatedDays: 5
    };
  }
};

function calculateBusinessDays(targetDay) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().getDay();
  const target = days.indexOf(targetDay);
  let count = 0;
  let current = today;
  
  while (current !== target) {
    current = (current + 1) % 7;
    if (current !== 0 && current !== 6) count++;
  }
  
  return count || 5;
}

exports.createShippingLabel = async (order, originAddress) => {
  try {
    const token = await getFedExToken();
    
    const totalWeight = Math.max(order.items.length * 5, 1);

    if (!order.deliveryDetails?.fullName || !order.deliveryDetails?.phoneNumber) {
      console.error('Missing required delivery details:', order.deliveryDetails);
      throw new Error('Missing required delivery details');
    }

    if (!originAddress.address || !originAddress.city || !originAddress.state || !originAddress.zipCode) {
      console.error('Invalid origin address:', originAddress);
      throw new Error('Invalid origin address');
    }

    const recipientPhone = formatPhoneNumber(order.deliveryDetails.phoneNumber);
    const shipperPhone = formatPhoneNumber(originAddress.phoneNumber);

    const requestBody = {
      requestedShipment: {
        shipper: {
          contact: {
            personName: originAddress.contactName || 'Estate Sale',
            phoneNumber: shipperPhone,
            companyName: 'Kept House Estate Sales'
          },
          address: {
            streetLines: [originAddress.address],
            city: originAddress.city,
            stateOrProvinceCode: originAddress.state,
            postalCode: originAddress.zipCode,
            countryCode: 'US',
            residential: false
          }
        },
        recipients: [{
          contact: {
            personName: order.deliveryDetails.fullName,
            phoneNumber: recipientPhone
          },
          address: {
            streetLines: [order.deliveryDetails.address],
            city: order.deliveryDetails.city,
            stateOrProvinceCode: order.deliveryDetails.state,
            postalCode: order.deliveryDetails.zipCode,
            countryCode: 'US',
            residential: true
          }
        }],
        shipDateStamp: new Date().toISOString().split('T')[0],
        pickupType: FEDEX_ACCOUNT ? 'USE_SCHEDULED_PICKUP' : 'DROPOFF_AT_FEDEX_LOCATION',
        serviceType: 'FEDEX_GROUND',
        packagingType: 'YOUR_PACKAGING',
        shippingChargesPayment: {
          paymentType: 'SENDER'
        },
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_85X11_TOP_HALF_LABEL'
        },
        requestedPackageLineItems: [{
          weight: {
            units: 'LB',
            value: totalWeight
          },
          dimensions: {
            length: 12,
            width: 12,
            height: 12,
            units: 'IN'
          }
        }]
      }
    };

    if (FEDEX_ACCOUNT) {
      requestBody.accountNumber = { value: FEDEX_ACCOUNT };
    }

    console.log('Creating FedEx label with request:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(
      `${FEDEX_BASE_URL}/ship/v1/shipments`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const shipmentData = response.data.output.transactionShipments[0];
    const trackingNumber = shipmentData.masterTrackingNumber;
    const labelUrl = shipmentData.pieceResponses[0].packageDocuments[0].url;

    console.log('Label created successfully:', trackingNumber);

    return {
      trackingNumber,
      labelUrl
    };

  } catch (error) {
    console.error('Label creation error:', error.response?.data || error.message);
    
    return {
      trackingNumber: 'TEST-' + Date.now(),
      labelUrl: null,
      note: 'Test environment - manual label creation required'
    };
  }
};