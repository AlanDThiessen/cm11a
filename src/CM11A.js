/******************************************************************************
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2018 Alan Thiessen
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 ******************************************************************************/

(function() {
    'use strict';

    const SerialPort = require('serialport');
    const cm11aCodes = require('./CM11ACodes');
    const transactions = require('./CM11ATransactions');

    var CM11A_BUAD = 4800;

    var EVENTS = {
        'unitStatus':   0,
        'status':       1,
        'close':        2
    };


    var CM11A = {
        serial: {},
        running: false,
        currentTrans: undefined,
        transactionQueue: [],
        events: {
            'unitStatus': undefined,
            'status': undefined,
            'close': undefined
        },

        // CM11A Commands
        on: SetEvent,
        start: Start,
        stop: Stop,
        stopped: Stopped,

        // Unit Function Commands
        turnOn: TurnOn,
        turnOff: TurnOff,

        // Callback methods
        notifyUnitStatus: NotifyUnitStatus,
        notifyCM11AStatus: NotifyStatus,
        write: SerialWrite,
        read: SerialRead,

        // Internally called methods
        runTransaction: RunTransaction,
        runQueuedTransaction: RunQueuedTransaction
    };


    function SetEvent(event, callBack) {
        if(!this.events.hasOwnProperty(event)) {
            throw('Invalid event: ' + event);
        }
        else if(typeof(callBack) !== 'function') {
            throw('Expected function for callBack.');
        }
        else {
            this.events[event] = callBack;
        }
    }

    /***
     * @returns {boolean}
     */
    function Start(device) {
        if(!this.running) {
            this.serial = new SerialPort(device, {
                baudRate: 4800
            });

            var ctrl = this;
            this.serial.on('data', function(data) {
                ctrl.read(data);
            });
            this.serial.on('error', HandleError);
            this.serial.on('close', function() {
                ctrl.stopped();
            });
            this.running = true;
        }

        return this.running;
    }


    /***
     * @returns {boolean}
     */
    function Stop() {
        if(this.currentTrans) {
            /* For now, let the transaction complete gracefully
            this.currentTrans.error('Shutting Down.');
            */
            this.running = false;
        }
        else {
            this.serial.close();
        }
    }


    function Stopped() {
        this.running = false;

        if(this.events.close) {
            this.events.close();
        }
    }


    function RunTransaction(trans) {
        var ctrl = this;

        if(ctrl.running) {
            if (ctrl.currentTrans === undefined) {
                ctrl.currentTrans = trans;
                ctrl.currentTrans.run().then(
                    function() {
                        ctrl.runQueuedTransaction();
                    },
                    function() {
                        ctrl.runQueuedTransaction();
                    });
            }
            else {
                ctrl.transactionQueue.push(trans);
            }
        }
    }


    function RunQueuedTransaction() {
        var ctrl = this;

        ctrl.currentTrans = undefined;

        if(ctrl.running) {
            if (ctrl.transactionQueue.length > 0) {
                ctrl.runTransaction(ctrl.transactionQueue.shift());
            }
        }
        else {
            ctrl.serial.close();
        }
    }


    function TurnOn(units) {
        var command = transactions.Command(this, cm11aCodes.functionCodes.ON, units);
        this.runTransaction(command);
    }


    function TurnOff(units) {
        var command = transactions.Command(this, cm11aCodes.functionCodes.OFF, units);
        this.runTransaction(command);
    }


    function NewCm11A() {
        var cm11Obj = Object.create(CM11A);
        return cm11Obj;
    }


    function SerialWrite(data) {
        this.serial.write(data, function(error) {
            if(error) {
                console.log('Error Writing to CM11A.');
            }
        });
    }


    function SerialRead(data) {
        var buffer = new Buffer(data);

        if(buffer.length > 0) {
            var usedBuffer = false;

            if(this.currentTrans) {
                usedBuffer = this.currentTrans.handleMessage(buffer);
            }

            if(!usedBuffer) {
                if(buffer[0] == cm11aCodes.rx.POLL_REQUEST) {
                    var pollResp = transactions.PollResponse(this, buffer);
                    this.runTransaction(pollResp);
                }
                else if(buffer[0] == cm11aCodes.rx.POLL_POWER_FAIL) {
                    var setClock = transactions.SetClock(this);
                    this.runTransaction(setClock);
                }
                else if(buffer[0] == cm11aCodes.rx.POLL_EEPROM_ADDRESS) {
                    var eepromAddress = transactions.EepromAddress(this, buffer);
                    this.runTransaction(eepromAddress);
                }
            }
        }
    }


    function NotifyUnitStatus(x10Function, houseCode, level, units ) {
        if(this.events.unitStatus !== undefined) {
            this.events.unitStatus( {
                'units': units,
                'x10Function': x10Function,
                'level': level
            });
        }
    }


    function NotifyStatus(status) {
        if(this.events.status !== undefined) {
            this.events.status(status);
        }
    }


    function HandleError(error) {
        console.log(error);
    }


    module.exports = NewCm11A;

})();