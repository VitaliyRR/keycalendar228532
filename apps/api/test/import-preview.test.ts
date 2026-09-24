import assert from 'node:assert/strict';
import test from 'node:test';
import {previewSchema} from '../src/import-preview.js';

const validPreview={
  organizationId:'11111111-1111-4111-8111-111111111111',
  asOf:'2026-09-24',
  properties:[],reservations:[],historicalReservations:[],
  clients:{rowCount:1,sampleRows:[{sourceRowId:'clients-xlsx-row-2',displayLabel:'Клиент из выгрузки, строка 2'}]},
  finance:{
    payments:{rowCount:1,linkedBookingCount:1,withoutBookingLinkCount:0,sampleRows:[{
      sourceRowId:'payment-2026-row-1',sourceBookingId:'123456',amountText:'1200',approvedInSource:false
    }]},
    expenses:{rowCount:1,sampleRows:[{sourceRowId:'expenses-xlsx-row-2',amountText:'250.50'}]},
    deposits:{rowCount:1,sections:[{label:'К возврату',rowCount:1}]}
  },
  coverage:{propertyCount:0,reservationCount:0,monthlyBookingCount:0,
    historicalReservationCount:0,archivedPropertyCount:0,clientRowCount:1,
    paymentRowCount:1,expenseRowCount:1,depositRowCount:1}
};

test('source preview accepts count and redacted sample fields',()=>{
  assert.equal(previewSchema.safeParse(validPreview).success,true);
});

test('source preview rejects contact fields and free-text client labels',()=>{
  const contactLeak=structuredClone(validPreview);
  Object.assign(contactLeak.clients.sampleRows[0],{phone:'+70000000000'});
  assert.equal(previewSchema.safeParse(contactLeak).success,false);

  const freeText=structuredClone(validPreview);
  freeText.clients.sampleRows[0].displayLabel='Фамилия Имя';
  assert.equal(previewSchema.safeParse(freeText).success,false);
});
