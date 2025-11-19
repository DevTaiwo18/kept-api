const axios = require('axios');

const FEDEX_API_KEY = process.env.FEDEX_API_KEY;
const FEDEX_SECRET = process.env.FEDEX_SECRET;
const FEDEX_ACCOUNT = process.env.FEDEX_ACCOUNT;
const FEDEX_BASE_URL = process.env.FEDEX_BASE_URL || 'https://apis-sandbox.fedex.com';

const HANDLING_MULTIPLIER = 2.5;

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

function calculateItemWeight(item) {
  if (item.weight && item.weight.value) {
    return item.weight.unit === 'kg' ? item.weight.value * 2.20462 : item.weight.value;
  }
  return 5;
}

function getItemDimensions(item) {
  if (item.dimensions && item.dimensions.length && item.dimensions.width && item.dimensions.height) {
    return {
      length: Math.max(Math.round(item.dimensions.length), 1),
      width: Math.max(Math.round(item.dimensions.width), 1),
      height: Math.max(Math.round(item.dimensions.height), 1)
    };
  }
  return { length: 12, width: 12, height: 12 };
}

exports.calculateShipping = async ({ originAddress, destinationAddress, items }) => {
  try {
    const token = await getFedExToken();
    
    const packages = items.map(item => {
      const weight = calculateItemWeight(item);
      const dimensions = getItemDimensions(item);
      
      return {
        weight: {
          units: 'LB',
          value: Math.max(Math.round(weight), 1)
        },
        dimensions: {
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          units: 'IN'
        }
      };
    });

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
        requestedPackageLineItems: packages
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
    const fedexRate = parseFloat(rateDetail.totalNetCharge) || 0;
    const handlingFee = fedexRate * (HANDLING_MULTIPLIER - 1);
    const totalShipping = fedexRate * HANDLING_MULTIPLIER;

    return {
      carrier: 'FedEx',
      service: groundService.serviceName,
      fedexRate: Math.round(fedexRate * 100) / 100,
      handlingFee: Math.round(handlingFee * 100) / 100,
      rate: Math.round(totalShipping * 100) / 100,
      estimatedDays: groundService.commit?.dateDetail?.dayOfWeek ? 
        calculateBusinessDays(groundService.commit.dateDetail.dayOfWeek) : 5
    };

  } catch (error) {
    console.error('FedEx rate calculation error:', error.response?.data || error.message);
    
    const fallbackFedexRate = 25.00;
    const fallbackHandlingFee = fallbackFedexRate * (HANDLING_MULTIPLIER - 1);
    const fallbackTotal = fallbackFedexRate * HANDLING_MULTIPLIER;
    
    return {
      carrier: 'FedEx',
      service: 'Ground (Estimated)',
      fedexRate: fallbackFedexRate,
      handlingFee: Math.round(fallbackHandlingFee * 100) / 100,
      rate: Math.round(fallbackTotal * 100) / 100,
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

    const packages = order.items.map(item => {
      const weight = calculateItemWeight(item);
      const dimensions = getItemDimensions(item);
      
      return {
        weight: {
          units: 'LB',
          value: Math.max(Math.round(weight), 1)
        },
        dimensions: {
          length: dimensions.length,
          width: dimensions.width,
          height: dimensions.height,
          units: 'IN'
        }
      };
    });

    const requestBody = {
      requestedShipment: {
        shipper: {
          contact: {
            personName: (originAddress.contactName || 'Estate Sale').trim(),
            phoneNumber: shipperPhone,
            companyName: 'Kept House Estate Sales'
          },
          address: {
            streetLines: [(originAddress.address || '').trim()],
            city: (originAddress.city || '').trim(),
            stateOrProvinceCode: originAddress.state,
            postalCode: originAddress.zipCode,
            countryCode: 'US',
            residential: false
          }
        },
        recipients: [{
          contact: {
            personName: (order.deliveryDetails.fullName || '').trim(),
            phoneNumber: recipientPhone
          },
          address: {
            streetLines: [(order.deliveryDetails.address || '').trim()],
            city: (order.deliveryDetails.city || '').trim(),
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
        requestedPackageLineItems: packages
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