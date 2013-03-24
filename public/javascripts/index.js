(function($){

  function letterInputsToString() {
    var board = $('input.letter').get().reduce(function(r,el){ return r + el.value; }, '');
    return board.toLowerCase().replace(/[^a-z]/, '');
  }

  function updateMoves() {
    colorBoard($mainBoard, oursBitMask, theirsBitMask);

    // did somebody win? show that
    if (lpBitMask.countBits(oursBitMask | theirsBitMask) == 25) {
      displayGameEnd(lpBitMask.countBits(oursBitMask) >= 13);

    // ok do we even have enough letters to get new words?
    } else if (letterInputsToString().length === 25) {
      queueUpdate();

    // just show nothing
    } else {
      hideMoves();
    }
  }


  function queueUpdate() {
    $('#results').show("slide", { direction: "left"}, SLIDE_DELAY_MS);
    $('#moves').addClass('fade').scrollTop(0);
    clearTimeout(queuedUpdate);
    if (lastUpdate === null || lastUpdate < Date.now() - UPDATE_WAIT_MS) {
      updateNow();
    } else {
      queuedUpdate = setTimeout(updateNow, UPDATE_WAIT_MS);
    }
  }

  function updateNow() {
    lastUpdate = Date.now();
    queuedUpdate = null;
    var board = letterInputsToString();
    getMovesForBoard(board, minFrequency, oursBitMask, theirsBitMask);
  }

  function hideMoves() {
    $('#results').hide("slide", { direction: "left" }, SLIDE_DELAY_MS);
  }

  function displayMoves(moves) {
    $('#loading').hide();
    $('#moves').removeClass('fade').scrollTop();
    $('#moves').scrollTop();
    var $moves = $('<div>')
    if (moves.length) {
      for (var i = 0; i < moves.length; i++) {
        // we expect [ "word", moveBitMask, moveOursBitMask, moveTheirsBitmask, gameEnder ]
        var move = moves[i];
        var word = move[0];
        var gameEnder = move[4]
        // see definition of gameEnderTag for why we add 1
        var $gameEnder = gameEnder === 0 ? '' : gameEnderTag[gameEnder + 1].clone();
        $moves.append(
          $('<div>').addClass('move').append(
            $('<table>').append(
              $('<tr>').addClass('moveRow').append(
                $('<td>').append(getPreviewBoard(move[2], move[3])),
                $('<td>').append(word, $gameEnder)
              )
            )
          )
          .data('moveWordBitMask', move[1])
          .data('moveOursBitMask', move[2])
          .data('moveTheirsBitMask', move[3])
          .hover(
            function(){
              colorBoard($mainBoard, $(this).data('moveOursBitMask'), $(this).data('moveTheirsBitMask'));
              wiggleMask($(this).data('moveWordBitMask'));
            },
            function(){
              colorBoard($mainBoard, oursBitMask, theirsBitMask);
              wiggleMask(0);
            }
          )
        );
      }
    } else {
      $moves.append($('<p>').addClass('gameAnnounce').append(msg.noMoves));
    }
    $('#moves').html($moves);
  }

  function displayGameEnd(win) {
    var message = msg.win,
        klass = 'ourScore';
    if (!win) {
      message = msg.lose,
      klass = 'theirScore';
    }
    $('#moves').html($('<p>').addClass(klass + ' gameAnnounce').append(message));
  }

  /**
   * Apply jquery transforms to positions matching bitmask & not matching
   * @param {Number} mask
   * @param {Function} onCb for element when matching
   * @param {String} offCb for elements that do not match
   */
  function maskApply($parent, mask, onCb, offCb) {
    var bit = 1;
    var selector = [];
    for(var i = 0; i <= 24; i++) {
      $el = $parent.find('.tdb' + i);
      if (mask & bit) {
        onCb($el);
      } else {
        offCb($el);
      }
      bit <<= 1;
    }
  }

  function classMask($parent, mask, klass) {
    maskApply(
      $parent,
      mask,
      function($el) { $el.addClass(klass); },
      function($el) { $el.removeClass(klass); }
    );
  }

  function wiggleMask(mask) {
    maskApply(
      $mainBoard,
      mask,
      function($el) {
        // we activate relative positioning so the shadows are over other non-wiggly cells
        $('#getBoard td').css({position: 'relative'});
        $el.addClass('shadow').wiggle('start');
      },
      function($el) {
        // take away all of style because *any* position seems to cause the highlighting of the input
        // to overlap with neighbors. Strange.
        $('#getBoard td').removeAttr('style');
        $el.removeClass('shadow').wiggle('stop');
      }
    )
  }

  function colorBoard($parent, oursBitMask, theirsBitMask) {
    function colorPlayer($parent, mask, klass) {
      classMask($parent, mask, klass);
      classMask($parent, lpBitMask.getProtectedBitMask(mask), klass + 'Protected');
    }
    colorPlayer($parent, oursBitMask, 'ours');
    colorPlayer($parent, theirsBitMask, 'theirs');
  }

  function getMovesForBoard(board, minFrequency, oursBitMask, theirsBitMask) {
    var newBoardState = [board, oursBitMask, theirsBitMask].join('\x01');
    if (newBoardState !== boardState) {
      apiCache = {};
    }
    boardState = newBoardState;
    if (apiCache[minFrequency]) {
      $('#actualApiRequestStats').hide();
      displayApiResult(apiCache[minFrequency]);
      return;
    }
    var ajaxRequest = {
      data: {
        seq: ++sequence,
        board: board,
        minFrequency: minFrequency,
        oursBitMask: oursBitMask,
        theirsBitMask: theirsBitMask,
        isClientComboAble: typeof comboWorker !== undefined
      },
      error: function(xhr, status, err) {
        console.log(xhr, status, err);
      },
      success: function(data, textStatus, xhr) {
        var resSequence = parseInt(data[0], 10);
        if (resSequence === sequence) {
          if (data[1] == 'moves') {
            /* if server was able to provide moves, we just display them */
            apiCache[minFrequency] = data;
            displayApiResult(data);
          } else if (data[1] == 'words') {
            /* if server was only able to provide words (due to timeout, or because we want to otherwise
               offload work to the client) and we can use a combo worker here to calculate moves, do that */
            if (typeof comboWorker !== 'undefined') {
              comboWorker.postMessage({
                seq: sequence,
                board: board,
                wordStructs: data[2],
                oursBitMask: oursBitMask,
                theirsBitMask: theirsBitMask,
                minFrequency: minFrequency
              });
            } else {
              console.log("we got a message to use a combo worker, but we can't do that!");
            }
          }
        }
      }
    }

    var startTime = new Date();
    var showSpinnerTimeout;
    if (xhr) {
      // don't send out two XHRs at once - abort the other one
      // we could still have a race condition, which we try to ameliorate with
      // the sequence number
      xhr.abort();
    }
    showSpinnerTimeout = setTimeout( function() { $('#loading').show(); }, LOADING_SPINNER_DELAY_MS );
    xhr = $.ajax('/api', ajaxRequest)
      .done(function(data) {
        // we won't need to abort this xhr, 'cause we're done.
        // is there a race condition here if someone else grabbed xhr?
        xhr = null;

        clearTimeout(showSpinnerTimeout);
        $('#loading').hide();
        // show some stats related to actual API calls
        // (not always shown if results were cached locally)
        $('#clientElapsedTime').html(((Date.now() - startTime)/1000).toFixed(3));
        $('#actualApiRequestStats').show();
      });
  }

  /**
   * We expect the api result to be:
   * data[0]  sequence number (ignored here)
   * data[1]  array of moves
   * data[2]  stats
   * @param {Array} data described above
   */
  function displayApiResult(data) {
    displayMoves(data[2]);
    displayStats(data[3]);
  }

  /**
   * display stats TODO this doesn't work with client combos
   * @param {Object} stats
   */
  function displayStats(stats) {
    $('#statsDictionaryCount').html(commify(stats.dictionaryLength));
    $('#statsWordsCount').html(commify(stats.wordsLength));
    $('#statsMoveCount').html(commify(stats.movesLength));
    $('#statsServerElapsedTime').html((stats.serverTime/1000).toFixed(3));
  }

  function getPreviewBoard(oursBitMask, theirsBitMask) {
    var $table = $('<table>').addClass('preview');
    for (var i = 0; i < 5; i++) {
      var $tr = $('<tr>');
      for (var j = 0; j < 5; j++) {
        var $td = $('<td>').addClass('tdb' + (i * 5 + j));
        $tr.append($td);
      }
      $table.append($tr);
    }
    colorBoard($table, oursBitMask, theirsBitMask);
    return $table;
  }

  function commify(n) {
    n = n.toString();
    var x = n.split("");
    for (var i = n.length - 3; i > 0; i-= 3) {
      x.splice(i, 0, ",");
    }
    return x.join("");
  }

  $('#randomize').click(function(e) {
    oursBitMask = 0;
    theirsBitMask = 0;
    queuedUpdate = null;
    sequence = 0;
    colorBoard($mainBoard, 0, 0); // why should we have to do this here? updateWords does it, but it happens slowly
    lastUpdate = null;

    $('input.letter').each(function() {
      // ascii 'a' = 65
      this.value = String.fromCharCode(Math.floor(Math.random()*26+65));
    });
    queueUpdate();
  })

  $('#paintControls .icon').parent().click(function(e) {
    $('#paintControls .iconHighlight').removeClass('active');
    $(this).addClass('active');
  });

  $('#enterText').parent().click(function(e) {
    $('input.letter')
      .removeClass('fillOurs fillTheirs fillNone')
      .keyup(function(event) {
        // this form has tabIndexes 1-25 for the inputs. Submit button is 26.
        if (event.which !== 9) {
          var nextTabIndex = (parseInt(this.tabIndex, 10) + 1).toString()
          $(this.form).find('[tabIndex=' + nextTabIndex.toString() + ']').focus().select();
        }
        updateMoves();
      })
      .removeAttr('readonly')
      .off('click')
      .on('click', function() {
        $(this).select();
      } );
  });

  // this is used for the three coloring tools - ours, theirs, none
  function getLetterPainterMode(klass, bitMaskOp) {
    return function() {
      $('input.letter')
        .attr('readonly', 'readonly')
        .off('click')
        .on('click', function(e) {
          bitMaskOp($(this).data('bitmask'));
          updateMoves();
        })
        .removeClass('fillOurs fillTheirs fillNone')
        .addClass(klass);
    };
  }

  $('#oursPaint').parent().click(
    getLetterPainterMode(
      'fillOurs',
      function(bitMask) {
        // remove this position from 'theirs'
        theirsBitMask &= ~bitMask;
        // toggle it in 'ours'
        oursBitMask |= bitMask;
      }
    )
  );

  $('#theirsPaint').parent().click(
    getLetterPainterMode(
      'fillTheirs',
      function(bitMask) {
        // remove this position from 'ours'
        oursBitMask &= ~bitMask;
        // toggle it in theirs
        theirsBitMask |= bitMask;
      }
    )
  );

  $('#nonePaint').parent().click(
    getLetterPainterMode(
      'fillNone',
      function(bitMask) {
        oursBitMask &= ~bitMask;
        theirsBitMask &= ~bitMask;
      }
    )
  );


  function updateSlider(event, ui) {
    minFrequency = frequencyNames[ui.value].minFrequency;
    $('#frequencyLabel').html(frequencyNames[ui.value].label);
  }


  /* worker initialization */
  var comboWorker;
  if (typeof Worker !== 'undefined') {
    var w = new Worker('/javascripts/browserify/clientMoveComboWorker.js');
    w.onmessage = function(oEvent) {
      var message = oEvent.data;
      var apiLikeData = [
        message.seq, /* sequence number - irrelevant to cache, done just to match signature. TODO fix */
        "moves",
        message.topMoves,
        [ 999, 999, 999, 999 ] /* fake stats - placeholder */
      ]
      apiCache[message.minFrequency] = apiLikeData;
      displayApiResult(apiLikeData);
    };
    comboWorker = w;
  }

  /* configuration */

  // TODO i18n
  var frequencyNames = [
    { minFrequency:18, label:'basic'},
    { minFrequency:15, label:'common' },
    { minFrequency:12, label:'highbrow'},
    { minFrequency:9, label:'obscure'},
    { minFrequency:0, label:'sesquipedalian'}
  ];

  var msg = {
    win: 'win',
    lose: 'lose',
    noMoves: 'no moves found'
  }

  /* constants */
  var SLIDE_DELAY_MS = 200;
  var UPDATE_WAIT_MS = 500;
  var LOADING_SPINNER_DELAY_MS = 1000;

  /* initialize board & other inputs */

  var oursBitMask = 0,
      theirsBitMask = 0,
      sequence = 0,
      initialFrequencySliderValue = 1,
      queuedUpdate = null,
      lastUpdate = null,
      $mainBoard = $('#getBoard'),
      xhr = null,
      apiCache = {},
      boardState = null;

  /* n.b. data comes to us as -1, 0, 1 so add 1 to get offset */
  var gameEnderTag = [
    $('<span>').addClass('gameAnnounce theirScore').append(msg.lose),
    null,
    $('<span>').addClass('gameAnnounce ourScore').append(msg.win)
  ];

  // set up initial toolbar highlights, active tool
  $('#enterText').parent().click();

  /* init frequency slider */

  $('#frequencyCtrl').slider({
    min: 0,
    max: frequencyNames.length - 1,
    change: function(event, ui) {
      updateSlider(event, ui);
    },
    slide: function(event,ui) {
      updateSlider(event, ui);
    },
    stop: function(event, ui) {
      updateMoves();
    },
  });

  $('#frequencyCtrl').slider( "value", initialFrequencySliderValue);

  /* init show / hide stats */
  $('#hideStats').click(function() {
    $('#stats').hide();
    $('#showStats').show();
  });
  $('#showStats a').click(function() {
    $('#stats').show();
    $('#showStats').hide();
  })

  /* init letters */

  $('input.letter')
   .each(function() {
      // we assume the name of the input is like 'b12' for the 13th position
      var pos = parseInt(this.name.substr(1), 10);
      $(this).data('pos', pos);
      $(this).data('bitmask', 1 << pos);
    })
    .click(function() {
    })


  // start off typing in the first position
  $('#b0').click();


})(jQuery);
