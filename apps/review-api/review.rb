require 'sinatra'
require "sinatra/reloader" if development?
require_relative 'googlesheet_reader'
# require 'sinatra/cross_origin'
require "sinatra/cors"
require "date"
require "ipaddr"

# CORS Settings for second cors gem
set :allow_origin, "*"
# set :allow_origin, "https://rtqmd.gtsb.io http://localhost:8000 https://rtqmd.gatsbyjs.io http://localhost:8001"
set :allow_methods, "GET,HEAD,POST,OPTIONS"
set :allow_headers, "content-type,if-modified-since"
set :expose_headers, "location,link,content-type"

configure do
  # CORS: Not required after switching gem
  # enable :cross_origin
  # set :allow_origin, :any
  # set :allow_methods, [:get, :post, :options]
  # set :allow_credentials, true
  # set :max_age, "1728000"
  # set :expose_headers, ['Content-Type']

  public_hosts = ENV.fetch("RTQ_REVIEW_API_PUBLIC_HOSTS", "rtq-review-api.ngrok.app")
                    .split(",")
                    .map(&:strip)
                    .reject(&:empty?)

  set :host_authorization, {
    permitted_hosts: [
      "localhost",
      ".localhost",
      ".test",
      *public_hosts,
      IPAddr.new("0.0.0.0/0"),
      IPAddr.new("::/0"),
    ],
  }

  uuids = File.readlines("#{__dir__}/uuid.txt")

  # Conver uuids to a hash based on the index
  all_uuids = uuids.each.with_index(1).map do |val, idx|
    uval = val.chomp
    {uval => idx}
  end

  all_uuids_dict = all_uuids.reduce({}, :merge!)

  set :uuids, all_uuids_dict

  set :review_rags, [:PRG, :PRCR, :PRCC, :PRBD, :PRCS]

  all_toml_rags = [
    "NS",
    "OPR",
    "G0",
    "NG0",
    "NG1",
    "NG2",
    "NG3",
    "NG4",
    "NG5",
    "NG6",
    "NG7",
    "NG8",
  ]

  all_sheets = [
    "NS",
    "G0",
    "NG0",
    "NG1",
    "NG2",
    "NG3",
    "NG4",
    "NG5",
    "NG6",
    "NG7",
    "NG8",
  ]

  set :toml_rags, all_toml_rags

  set :sheets, all_sheets

  #set :prod_spreadsheet_id, "1Sk93dRT4MJI2I0c7Zl_7a3cvz0vXr6SHqQyotu4MIqo"
  # set :prod_spreadsheet_id, "1F1D3HnduBxjybZHTOke0vKdpTtUiVJ-H6AfeXgtUhWI"
  set :prod_spreadsheet_id, "1hA-e7NuURHeVI5v7SJcG_bzVJQUbHrMU8ND-kg2TZ4s"
  set :dev_spreadsheet_id, "18DJYYxtkAO6Vxz93p-2AJiGqs1TBZ-Y3j8DPTN0Rggk"
end

#CORS: Not required after switching gem
# options "*" do
#   response.headers["Allow"] = "HEAD,GET,PUT,POST,DELETE,OPTIONS"
#   response.headers["Access-Control-Allow-Headers"] = "X-Requested-With, X-HTTP-Method-Override, Content-Type, Cache-Control, Accept"
#   200
# end

get '/' do
  {
    status: "success",
    reason: "Up, up and away!!!"
  }.to_json
end

post '/rag' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_rag_request(request_payload, googlesheet_reader, :answer)
  if request_status != "ok"
    puts "RAG Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = update_rag_values(request_payload, googlesheet_reader, :answer)
  if update_values_status != "ok"
    puts "RAG Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "RAG Success: Updated"

  {
    status: "success",
    reason: "RAG updated"
  }.to_json
end

post '/questionrag' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_rag_request(request_payload, googlesheet_reader, :question)
  if request_status != "ok"
    puts "RAG Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = update_rag_values(request_payload, googlesheet_reader, :question)
  if update_values_status != "ok"
    puts "RAG Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "RAG Success: Updated"

  {
    status: "success",
    reason: "RAG updated"
  }.to_json
end


post '/addsubtag' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_subtag_request(request_payload, googlesheet_reader)
  if request_status != "ok"
    logger.info "RAG Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = add_subtag_values(request_payload, googlesheet_reader)
  if update_values_status != "ok"
    logger.info "RAG Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  logger.info "SubTag Success: Added"

  {
    status: "success",
    reason: "SubTag Added"
  }.to_json
end

post '/removesubtag' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_subtag_request(request_payload, googlesheet_reader)
  if request_status != "ok"
    logger.info "RAG Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = remove_subtag_values(request_payload, googlesheet_reader)
  if update_values_status != "ok"
    logger.info "RAG Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  logger.info "SubTag Success: Removed"

  {
    status: "success",
    reason: "SubTag Removed"
  }.to_json
end


post '/comments' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_comment_request(request_payload, googlesheet_reader, :answer)
  if request_status != "ok"
    puts "Comment Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = update_comment_values(request_payload, googlesheet_reader, :answer)
  if update_values_status != "ok"
    puts "Comment Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "Success: Comments Updated"

  {
    status: "success",
    reason: "Comments updated"
  }.to_json
end

post '/resetanswercomments' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_reset_question_answer_comment_request(request_payload, googlesheet_reader, :answer)
  if request_status != "ok"
    puts "Comment Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = reset_question_answer_comment_values(request_payload, googlesheet_reader, :answer)
  if update_values_status != "ok"
    puts "Comment Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "Success: Comments Updated"

  {
    status: "success",
    reason: "Comments updated"
  }.to_json
end

post '/resetquestioncomments' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_reset_question_answer_comment_request(request_payload, googlesheet_reader, :question)
  if request_status != "ok"
    puts "Comment Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = reset_question_answer_comment_values(request_payload, googlesheet_reader, :question)
  if update_values_status != "ok"
    puts "Comment Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "Success: Comments Updated"

  {
    status: "success",
    reason: "Comments updated"
  }.to_json
end

post '/questioncomments' do
  request_payload = parse_request(request)

  googlesheet_reader = GoogleSheetReader.new

  request_status = validate_comment_request(request_payload, googlesheet_reader, :question)
  if request_status != "ok"
    puts "Comment Error: #{request_status}"

    return [400, {
      status: "error",
      reason: request_status
    }.to_json]
  end

  update_values_status = update_comment_values(request_payload, googlesheet_reader, :question)
  if update_values_status != "ok"
    puts "Comment Error: #{update_values_status}"

    return [400, {
      status: "error",
      reason: update_values_status
    }.to_json]
  end

  puts "Success: Comments Updated"

  {
    status: "success",
    reason: "Comments updated"
  }.to_json
end

helpers do
  def parse_request(request)
    request.body.rewind
    request_payload = JSON.parse(request.body.read, symbolize_names: true)

    request_payload
  end

  def validate_global_rag_request(request_payload, googlesheet_reader, request_type)
    uuid = request_payload[:uuid]
    sheet = request_payload[:sheet]

    row_idx = settings.uuids[uuid]

    if uuid == nil
      return "Invalid Request: UUID missing in the request"
    end

    row_idx = settings.uuids[uuid]
    if row_idx == nil
      return "Invalid Request: UUID not found in UUID Cache"
    end

    if sheet == nil
      return "Invalid Request: Sheet attribute missing in the request"
    end

    sheet = sheet.upcase
    if not settings.sheets.include?(sheet)
      return "Invalid request: Invalid Sheet: #{sheet}"
    end

    sheet_name = "Answers - Reviews - #{sheet}"
    if request_type == :question
      sheet_name = "Questions - Reviews - #{sheet}"
    end

    read_range_name = "#{sheet_name}!A#{row_idx}:H#{row_idx}"
    logger.info(read_range_name)
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)
    logger.info(read_values)

    # Validate we are updating the right row in the sheet
    sheet_uuid = read_values[0][1]
    if uuid != sheet_uuid
      return "Internal Error: Index mismatch between api and sheet"
    end

    return "ok"
  end

  def validate_global_subtag_request(request_payload, googlesheet_reader)
    uuid = request_payload[:uuid]
    subtag = request_payload[:subtag]

    row_idx = settings.uuids[uuid]

    if uuid == nil
      return "Invalid Request: UUID missing in the request"
    end

    row_idx = settings.uuids[uuid]
    if row_idx == nil
      return "Invalid Request: UUID not found in UUID Cache"
    end

    sheet_name = "Mapping - SubTags"

    read_range_name = "#{sheet_name}!A#{row_idx}:E#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)

    # Validate we are updating the right row in the sheet
    sheet_uuid = read_values[0][0]
    if uuid != sheet_uuid
      logger.info(uuid)
      logger.info read_values[0]
      return "Internal Error: Index mismatch between api and sheet: "
    end

    if subtag == nil
      return "Invalid Request: Subtag missing in the request"
    end

    if not (1..13).include?(subtag.to_i)
      return "Invalid Request: Subtag not in the range"
    end

    return "ok"
  end

  def updated_spreadsheet_id
    #settings.dev_spreadsheet_id
    settings.prod_spreadsheet_id
  end

  def validate_rag_request(request_payload, googlesheet_reader, request_type)
    request_status = validate_global_rag_request(request_payload, googlesheet_reader, request_type)
    if request_status != "ok"
      return request_status
    end

    sheet = request_payload[:sheet]
    uuid = request_payload[:uuid]

    row_idx = settings.uuids[uuid]
    review_rag = request_payload[:rag]

    if review_rag == nil
      return "Invalid Request: Review RAG missing in the request"
    end

    review_rag = review_rag.to_s.strip
    if !review_rag.empty? &&
       !settings.review_rags.include?(review_rag.upcase.to_sym)
      return "Invalid request: Unknown State: #{review_rag.upcase}"
    end

    sheet_name = "Answers - Reviews - #{sheet}"
    if request_type == :question
      sheet_name = "Questions - Reviews - #{sheet}"
    end

    read_range_name = "#{sheet_name}!A#{row_idx}:H#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)

    # Validate TOML Rag is in right RAG before we update
    toml_rag = read_values[0][2]
    # logger.info settings.toml_rags
    # logger.info toml_rag
    if not settings.toml_rags.include?(toml_rag)
      return "Invalid request: Unknown TOML RAG: #{toml_rag}"
    end

    return "ok"
  end

  def validate_subtag_request(request_payload, googlesheet_reader)
    request_status = validate_global_subtag_request(request_payload, googlesheet_reader)
    if request_status != "ok"
      return request_status
    end

    return "ok"
  end

  def validate_comment_request(request_payload, googlesheet_reader, request_type)
    request_status = validate_global_rag_request(request_payload, googlesheet_reader, request_type)
    if request_status != "ok"
      return request_status
    end

    comment = request_payload[:comment]
    if comment == nil
      return "Invalid Request: Comment missing in the request"
    end

    return "ok"
  end

  def validate_reset_question_answer_comment_request(request_payload, googlesheet_reader, request_type)
    request_status = validate_global_rag_request(request_payload, googlesheet_reader, request_type)
    if request_status != "ok"
      return request_status
    end

    return "ok"
  end

  def update_comment_values(request_payload, googlesheet_reader, request_type)
    uuid = request_payload[:uuid]
    row_idx = settings.uuids[uuid]
    comment = request_payload[:comment]
    sheet = request_payload[:sheet]
    reviewer = request_payload[:reviewer] || :wf

    # Read the TOML Rag value to find which sheet to use
    sheet_name = "Answers - Reviews - #{sheet}"
    if request_type == :question
      sheet_name = "Questions - Reviews - #{sheet}"
    end

    read_range_name = "#{sheet_name}!A#{row_idx}:H#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)
    previous_comments = read_values[0][7]

    logger.info "Sheet:[#{sheet_name}] UUID:[#{uuid}] Comment:[#{comment}]"

    current_time = DateTime.now
    date_stamp = current_time.strftime "%Y-%m-%d::%H:%M"

    write_range_name = "#{sheet_name}!H#{row_idx}"
    write_review_rag_value = [["#{previous_comments}\n\n#{comment}"]]
    write_review_rag_value = [["#{previous_comments}\n\nReviewer: [#{reviewer.to_s}] Date:#{date_stamp}\n\n#{comment}"]]
    # logger.info write_review_rag_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_rag_value, 'USER_ENTERED')

    return "ok"
  end

  def reset_question_answer_comment_values(request_payload, googlesheet_reader, request_type)
    uuid = request_payload[:uuid]
    row_idx = settings.uuids[uuid]
    sheet = request_payload[:sheet]

    # Read the TOML Rag value to find which sheet to use
    sheet_name = "Answers - Reviews - #{sheet}"
    if request_type == :question
      sheet_name = "Questions - Reviews - #{sheet}"
    end

    read_range_name = "#{sheet_name}!A#{row_idx}:H#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)

    logger.info "Sheet:[#{sheet_name}] UUID:[#{uuid}]"

    write_range_name = "#{sheet_name}!H#{row_idx}"
    write_review_rag_value = [[""]]
    # logger.info write_review_rag_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_rag_value, 'USER_ENTERED')

    return "ok"
  end

  def update_rag_values(request_payload, googlesheet_reader, request_type)
    uuid = request_payload[:uuid]
    row_idx = settings.uuids[uuid]
    state = request_payload[:rag].to_s.strip.upcase
    sheet = request_payload[:sheet]
    reviewer = request_payload[:reviewer] || :wf

    # Read the TOML Rag value to find which sheet to use
    sheet_name = "Answers - Reviews - #{sheet}"
    if request_type == :question
      sheet_name = "Questions - Reviews - #{sheet}"
    end

    logger.info "Sheet:[#{sheet_name}] UUID:[#{uuid}] State:[#{state}]"

    # Update values in the sheet based on TOML Rag
    write_range_name = "#{sheet_name}!F#{row_idx}"
    logger.info write_range_name
    write_review_rag_value = [[state.to_s]]
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_rag_value, 'USER_ENTERED')

    return "ok"
  end

  def add_subtag_values(request_payload, googlesheet_reader)
    uuid = request_payload[:uuid]
    row_idx = settings.uuids[uuid]
    subtag = request_payload[:subtag].to_i

    # Read the TOML Rag value to find which sheet to use
    sheet_name = "Mapping - SubTags"

    logger.info "Sheet:[#{sheet_name}] UUID:[#{uuid}] SubTag:[#{subtag}]"

    read_range_name = "#{sheet_name}!A#{row_idx}:E#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)
    previous_subtags_strings = read_values[0][4]
    logger.info "Previous subtag: #{previous_subtags_strings}"


    previous_subtags = previous_subtags_strings.split('_').map { |tag| tag.to_i }
    logger.info "Previous subtag parsed: #{previous_subtags}"

    previous_subtags << subtag
    updated_subtags = previous_subtags.uniq.sort.join('_')
    logger.info "Updating subtag: #{updated_subtags}"

    write_range_name = "#{sheet_name}!E#{row_idx}"
    logger.info write_range_name
    write_review_subtags_value = [[updated_subtags]]
    logger.info write_review_subtags_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_subtags_value, 'USER_ENTERED')

    subtag_state = "S"
    write_range_name = "#{sheet_name}!C#{row_idx}"
    logger.info write_range_name
    write_review_subtags_value = [[subtag_state]]
    logger.info write_review_subtags_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_subtags_value, 'USER_ENTERED')

    return "ok"
  end

  def remove_subtag_values(request_payload, googlesheet_reader)
    uuid = request_payload[:uuid]
    row_idx = settings.uuids[uuid]
    subtag = request_payload[:subtag].to_i

    # Read the TOML Rag value to find which sheet to use
    sheet_name = "Mapping - SubTags"

    logger.info "Sheet:[#{sheet_name}] UUID:[#{uuid}] SubTag:[#{subtag}]"

    read_range_name = "#{sheet_name}!A#{row_idx}:E#{row_idx}"
    read_values = googlesheet_reader.get_values(updated_spreadsheet_id, read_range_name)
    previous_subtags_strings = read_values[0][4]
    logger.info "Previous subtag: #{previous_subtags_strings}"


    previous_subtags = previous_subtags_strings.split('_').map { |tag| tag.to_i }
    logger.info "Previous subtag parsed: #{previous_subtags}"

    previous_subtags.delete(subtag)
    updated_subtags = previous_subtags.uniq.sort.join('_')
    logger.info "Updating subtag: #{updated_subtags}"

    write_range_name = "#{sheet_name}!E#{row_idx}"
    logger.info write_range_name
    write_review_subtags_value = [[updated_subtags]]
    logger.info write_review_subtags_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_subtags_value, 'USER_ENTERED')

    subtag_state = "S"
    write_range_name = "#{sheet_name}!C#{row_idx}"
    logger.info write_range_name
    write_review_subtags_value = [[subtag_state]]
    logger.info write_review_subtags_value
    googlesheet_reader.update_values(updated_spreadsheet_id, write_range_name, write_review_subtags_value, 'USER_ENTERED')

    return "ok"
  end

end
